use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap, Vector};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, near_bindgen, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    Promise,
};
use sha2::{Digest, Sha256};

// Constants
const MIN_TIMELOCK: u64 = 3600; // 1 hour
const MAX_TIMELOCK: u64 = 2592000; // 30 days
const TGAS: u64 = 1_000_000_000_000;

// Storage keys
#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    HTLCs,
    PartialFills { htlc_id_hash: Vec<u8> },
    SafetyDeposits,
    SecretToHTLC,
    UserHTLCs { user_hash: Vec<u8> },
    ActiveHTLCs,
}

// Main HTLC structure supporting both full and partial fills
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct FusionHTLC {
    pub id: String,
    pub sender: AccountId,
    pub receiver: AccountId,
    pub token_id: Option<AccountId>, // None for NEAR, Some for NEP-141
    pub total_amount: U128,
    pub remaining_amount: U128,
    pub hashlock: String,
    pub timelock: U64,
    pub secret: Option<String>,
    pub allow_partial_fills: bool,
    pub min_fill_amount: U128,
    pub safety_deposit_amount: U128,
    pub status: HTLCStatus,
    pub created_at: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub enum HTLCStatus {
    Active,
    Completed,
    Refunded,
    PartiallyFilled,
}

// Partial fill structure
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct PartialFill {
    pub id: String,
    pub htlc_id: String,
    pub filler: AccountId,
    pub amount: U128,
    pub status: FillStatus,
    pub created_at: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub enum FillStatus {
    Pending,
    Completed,
    Refunded,
}

// Safety deposit for resolvers
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct SafetyDeposit {
    pub id: String,
    pub htlc_id: String,
    pub depositor: AccountId,
    pub amount: U128,
    pub created_at: U64,
}

// Events
#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HTLCCreatedEvent {
    pub htlc_id: String,
    pub sender: AccountId,
    pub receiver: AccountId,
    pub amount: U128,
    pub hashlock: String,
    pub timelock: U64,
    pub allow_partial_fills: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HTLCWithdrawnEvent {
    pub htlc_id: String,
    pub secret: String,
    pub withdrawn_by: AccountId,
    pub amount: U128,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PartialFillCreatedEvent {
    pub fill_id: String,
    pub htlc_id: String,
    pub filler: AccountId,
    pub amount: U128,
}

// Main contract
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct FusionPlusContract {
    htlcs: UnorderedMap<String, FusionHTLC>,
    partial_fills: LookupMap<String, Vector<PartialFill>>,
    safety_deposits: UnorderedMap<String, SafetyDeposit>,
    secret_to_htlc: LookupMap<String, String>,
    user_htlcs: LookupMap<AccountId, Vector<String>>,
    active_htlcs: Vector<String>,
    next_htlc_id: u64,
    next_fill_id: u64,
    next_deposit_id: u64,
    total_volume: U128,
    total_htlcs_created: u64,
}

#[near_bindgen]
impl FusionPlusContract {
    #[init]
    pub fn new() -> Self {
        Self {
            htlcs: UnorderedMap::new(StorageKey::HTLCs),
            partial_fills: LookupMap::new(StorageKey::PartialFills { htlc_id_hash: vec![] }),
            safety_deposits: UnorderedMap::new(StorageKey::SafetyDeposits),
            secret_to_htlc: LookupMap::new(StorageKey::SecretToHTLC),
            user_htlcs: LookupMap::new(StorageKey::UserHTLCs { user_hash: vec![] }),
            active_htlcs: Vector::new(StorageKey::ActiveHTLCs),
            next_htlc_id: 1,
            next_fill_id: 1,
            next_deposit_id: 1,
            total_volume: U128(0),
            total_htlcs_created: 0,
        }
    }

    // Create HTLC with optional partial fills support
    #[payable]
    pub fn create_htlc(
        &mut self,
        receiver: AccountId,
        hashlock: String,
        timelock_seconds: u64,
        allow_partial_fills: bool,
        min_fill_amount: Option<U128>,
        require_safety_deposit: bool,
    ) -> String {
        let sender = env::predecessor_account_id();
        let amount = env::attached_deposit();
        let current_time = env::block_timestamp() / 1_000_000_000;

        // Validations
        require!(amount > NearToken::from_yoctonear(0), "Amount must be greater than 0");
        require!(hashlock.len() == 64, "Invalid hashlock");
        require!(timelock_seconds >= MIN_TIMELOCK && timelock_seconds <= MAX_TIMELOCK, "Invalid timelock");

        let min_fill = if allow_partial_fills {
            let min = min_fill_amount.unwrap_or(U128(amount.as_yoctonear() / 10)); // Default 10%
            require!(min.0 > 0 && min.0 <= amount.as_yoctonear(), "Invalid min fill amount");
            min
        } else {
            U128(amount.as_yoctonear())
        };

        let htlc_id = format!("htlc_{}", self.next_htlc_id);
        self.next_htlc_id += 1;

        let htlc = FusionHTLC {
            id: htlc_id.clone(),
            sender: sender.clone(),
            receiver: receiver.clone(),
            token_id: None,
            total_amount: U128(amount.as_yoctonear()),
            remaining_amount: U128(amount.as_yoctonear()),
            hashlock: hashlock.clone(),
            timelock: U64(current_time + timelock_seconds),
            secret: None,
            allow_partial_fills,
            min_fill_amount: min_fill,
            safety_deposit_amount: U128(if require_safety_deposit { amount.as_yoctonear() / 20 } else { 0 }),
            status: HTLCStatus::Active,
            created_at: U64(current_time),
        };

        // Store HTLC
        self.htlcs.insert(&htlc_id, &htlc);
        self.secret_to_htlc.insert(&hashlock, &htlc_id);
        self.active_htlcs.push(&htlc_id);

        // Track user HTLCs
        self.add_user_htlc(&sender, &htlc_id);
        self.add_user_htlc(&receiver, &htlc_id);

        // Update stats
        self.total_volume = U128(self.total_volume.0 + amount.as_yoctonear());
        self.total_htlcs_created += 1;

        // Initialize partial fills vector if needed
        if allow_partial_fills {
            let fills_key = Self::get_fills_key(&htlc_id);
            self.partial_fills.insert(&htlc_id, &Vector::new(fills_key));
        }

        // Emit event
        env::log_str(&serde_json::to_string(&HTLCCreatedEvent {
            htlc_id: htlc_id.clone(),
            sender,
            receiver,
            amount: U128(amount.as_yoctonear()),
            hashlock,
            timelock: U64(current_time + timelock_seconds),
            allow_partial_fills,
        }).unwrap());

        htlc_id
    }

    // Withdraw funds by providing the correct secret
    pub fn withdraw(&mut self, htlc_id: String, secret: String) -> Promise {
        let mut htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        let withdrawer = env::predecessor_account_id();

        // Validations
        require!(htlc.status == HTLCStatus::Active || htlc.status == HTLCStatus::PartiallyFilled, "HTLC not active");
        require!(current_time < htlc.timelock.0, "HTLC expired");
        require!(withdrawer == htlc.receiver, "Not the receiver");
        require!(!htlc.allow_partial_fills, "Use withdraw_partial for partial fills");

        // Verify secret
        self.verify_secret(&secret, &htlc.hashlock);

        // Update HTLC
        htlc.status = HTLCStatus::Completed;
        htlc.secret = Some(secret.clone());
        self.htlcs.insert(&htlc_id, &htlc);

        // Remove from active
        self.remove_from_active(&htlc_id);

        // Emit event
        env::log_str(&serde_json::to_string(&HTLCWithdrawnEvent {
            htlc_id,
            secret,
            withdrawn_by: withdrawer.clone(),
            amount: htlc.total_amount,
        }).unwrap());

        // Transfer funds
        Promise::new(withdrawer).transfer(NearToken::from_yoctonear(htlc.total_amount.0))
    }

    // Create a partial fill
    #[payable]
    pub fn create_partial_fill(&mut self, htlc_id: String, fill_amount: U128) -> String {
        let mut htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let filler = env::predecessor_account_id();
        let attached = env::attached_deposit();
        let current_time = env::block_timestamp() / 1_000_000_000;

        // Validations
        require!(htlc.allow_partial_fills, "Partial fills not allowed");
        require!(htlc.status == HTLCStatus::Active || htlc.status == HTLCStatus::PartiallyFilled, "HTLC not active");
        require!(current_time < htlc.timelock.0, "HTLC expired");
        require!(fill_amount.0 >= htlc.min_fill_amount.0, "Below minimum fill");
        require!(fill_amount.0 <= htlc.remaining_amount.0, "Exceeds remaining amount");
        require!(attached >= NearToken::from_yoctonear(fill_amount.0), "Insufficient deposit");

        // Create fill
        let fill_id = format!("fill_{}", self.next_fill_id);
        self.next_fill_id += 1;

        let fill = PartialFill {
            id: fill_id.clone(),
            htlc_id: htlc_id.clone(),
            filler: filler.clone(),
            amount: fill_amount,
            status: FillStatus::Pending,
            created_at: U64(current_time),
        };

        // Store fill
        let mut fills = self.partial_fills.get(&htlc_id)
            .unwrap_or_else(|| Vector::new(Self::get_fills_key(&htlc_id)));
        fills.push(&fill);
        self.partial_fills.insert(&htlc_id, &fills);

        // Update HTLC
        htlc.remaining_amount = U128(htlc.remaining_amount.0 - fill_amount.0);
        htlc.status = HTLCStatus::PartiallyFilled;
        self.htlcs.insert(&htlc_id, &htlc);

        // Return excess
        if attached > NearToken::from_yoctonear(fill_amount.0) {
            Promise::new(filler.clone()).transfer(attached.saturating_sub(NearToken::from_yoctonear(fill_amount.0)));
        }

        // Emit event
        env::log_str(&serde_json::to_string(&PartialFillCreatedEvent {
            fill_id: fill_id.clone(),
            htlc_id,
            filler,
            amount: fill_amount,
        }).unwrap());

        fill_id
    }

    // Withdraw a partial fill
    pub fn withdraw_partial(&mut self, htlc_id: String, fill_id: String, secret: String) -> Promise {
        let htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        let withdrawer = env::predecessor_account_id();

        // Validations
        require!(withdrawer == htlc.receiver, "Not the receiver");
        require!(current_time < htlc.timelock.0, "HTLC expired");
        
        // Verify secret
        self.verify_secret(&secret, &htlc.hashlock);

        // Find and update fill
        let mut fills = self.partial_fills.get(&htlc_id).expect("No fills found");
        let mut fill_index = None;
        for i in 0..fills.len() {
            if fills.get(i).unwrap().id == fill_id {
                fill_index = Some(i);
                break;
            }
        }
        
        let idx = fill_index.expect("Fill not found");
        let mut fill = fills.get(idx).unwrap();
        require!(fill.status == FillStatus::Pending, "Fill already processed");
        
        fill.status = FillStatus::Completed;
        fills.replace(idx, &fill);
        self.partial_fills.insert(&htlc_id, &fills);

        // Update HTLC if all fills completed
        let mut htlc_mut = htlc.clone();
        if htlc_mut.remaining_amount.0 == 0 && self.all_fills_completed(&htlc_id) {
            htlc_mut.status = HTLCStatus::Completed;
            htlc_mut.secret = Some(secret.clone());
            self.htlcs.insert(&htlc_id, &htlc_mut);
            self.remove_from_active(&htlc_id);
        }

        // Transfer to receiver
        Promise::new(withdrawer).transfer(NearToken::from_yoctonear(fill.amount.0))
    }

    // Refund HTLC after timeout
    pub fn refund(&mut self, htlc_id: String) -> Promise {
        let mut htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        let refunder = env::predecessor_account_id();

        // Validations
        require!(refunder == htlc.sender, "Not the sender");
        require!(current_time >= htlc.timelock.0, "Not expired");
        require!(htlc.status != HTLCStatus::Completed && htlc.status != HTLCStatus::Refunded, "Already processed");

        // Calculate refund amount
        let refund_amount = if htlc.allow_partial_fills {
            htlc.remaining_amount.0
        } else {
            htlc.total_amount.0
        };

        // Update status
        htlc.status = HTLCStatus::Refunded;
        self.htlcs.insert(&htlc_id, &htlc);
        self.remove_from_active(&htlc_id);

        // Refund
        Promise::new(refunder).transfer(NearToken::from_yoctonear(refund_amount))
    }

    // Refund a partial fill after timeout
    pub fn refund_partial_fill(&mut self, htlc_id: String, fill_id: String) -> Promise {
        let htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        
        require!(current_time >= htlc.timelock.0, "Not expired");

        // Find and update fill
        let mut fills = self.partial_fills.get(&htlc_id).expect("No fills found");
        let mut fill_index = None;
        let mut filler = None;
        let mut amount = 0u128;

        for i in 0..fills.len() {
            let fill = fills.get(i).unwrap();
            if fill.id == fill_id {
                require!(fill.status == FillStatus::Pending, "Fill already processed");
                require!(env::predecessor_account_id() == fill.filler, "Not the filler");
                fill_index = Some(i);
                filler = Some(fill.filler.clone());
                amount = fill.amount.0;
                break;
            }
        }

        let idx = fill_index.expect("Fill not found");
        let mut fill = fills.get(idx).unwrap();
        fill.status = FillStatus::Refunded;
        fills.replace(idx, &fill);
        self.partial_fills.insert(&htlc_id, &fills);

        // Update HTLC remaining amount
        let mut htlc_mut = htlc.clone();
        htlc_mut.remaining_amount = U128(htlc_mut.remaining_amount.0 + amount);
        self.htlcs.insert(&htlc_id, &htlc_mut);

        // Refund to filler
        Promise::new(filler.unwrap()).transfer(NearToken::from_yoctonear(amount))
    }

    // Create safety deposit
    #[payable]
    pub fn create_safety_deposit(&mut self, htlc_id: String) -> String {
        let htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let depositor = env::predecessor_account_id();
        let amount = env::attached_deposit();
        let current_time = env::block_timestamp() / 1_000_000_000;

        require!(htlc.safety_deposit_amount.0 > 0, "Safety deposit not required");
        require!(amount >= NearToken::from_yoctonear(htlc.safety_deposit_amount.0), "Insufficient deposit");

        let deposit_id = format!("deposit_{}", self.next_deposit_id);
        self.next_deposit_id += 1;

        let deposit = SafetyDeposit {
            id: deposit_id.clone(),
            htlc_id: htlc_id.clone(),
            depositor: depositor.clone(),
            amount: U128(amount.as_yoctonear()),
            created_at: U64(current_time),
        };

        self.safety_deposits.insert(&deposit_id, &deposit);
        deposit_id
    }

    // Claim safety deposit
    pub fn claim_safety_deposit(&mut self, deposit_id: String) -> Promise {
        let deposit = self.safety_deposits.get(&deposit_id).expect("Deposit not found");
        let claimer = env::predecessor_account_id();

        require!(claimer == deposit.depositor, "Not the depositor");

        self.safety_deposits.remove(&deposit_id);
        Promise::new(claimer).transfer(NearToken::from_yoctonear(deposit.amount.0))
    }

    // View methods
    pub fn get_htlc(&self, htlc_id: String) -> Option<FusionHTLC> {
        self.htlcs.get(&htlc_id)
    }

    pub fn get_htlc_by_hashlock(&self, hashlock: String) -> Option<FusionHTLC> {
        self.secret_to_htlc.get(&hashlock)
            .and_then(|htlc_id| self.htlcs.get(&htlc_id))
    }

    pub fn get_user_htlcs(&self, user: AccountId, offset: u64, limit: u64) -> Vec<FusionHTLC> {
        self.user_htlcs.get(&user)
            .map(|htlc_ids| {
                htlc_ids.iter()
                    .skip(offset as usize)
                    .take(limit as usize)
                    .filter_map(|id| self.htlcs.get(&id))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_active_htlcs(&self, offset: u64, limit: u64) -> Vec<FusionHTLC> {
        self.active_htlcs.iter()
            .skip(offset as usize)
            .take(limit as usize)
            .filter_map(|id| self.htlcs.get(&id))
            .collect()
    }

    pub fn get_partial_fills(&self, htlc_id: String) -> Vec<PartialFill> {
        self.partial_fills.get(&htlc_id)
            .map(|fills| fills.iter().collect())
            .unwrap_or_default()
    }

    pub fn get_stats(&self) -> (U128, u64, u64) {
        (self.total_volume, self.total_htlcs_created, self.active_htlcs.len())
    }

    pub fn can_withdraw(&self, htlc_id: String) -> bool {
        if let Some(htlc) = self.htlcs.get(&htlc_id) {
            let current_time = env::block_timestamp() / 1_000_000_000;
            (htlc.status == HTLCStatus::Active || htlc.status == HTLCStatus::PartiallyFilled) 
                && current_time < htlc.timelock.0
        } else {
            false
        }
    }

    pub fn can_refund(&self, htlc_id: String) -> bool {
        if let Some(htlc) = self.htlcs.get(&htlc_id) {
            let current_time = env::block_timestamp() / 1_000_000_000;
            htlc.status != HTLCStatus::Completed 
                && htlc.status != HTLCStatus::Refunded 
                && current_time >= htlc.timelock.0
        } else {
            false
        }
    }

    // Helper methods
    fn verify_secret(&self, secret: &str, hashlock: &str) {
        let secret_bytes = hex::decode(secret).expect("Invalid hex secret");
        let mut hasher = Sha256::new();
        hasher.update(&secret_bytes);
        let hash = hex::encode(hasher.finalize());
        require!(hash == hashlock, "Invalid secret");
    }

    fn add_user_htlc(&mut self, user: &AccountId, htlc_id: &str) {
        let mut user_htlcs = self.user_htlcs.get(user)
            .unwrap_or_else(|| {
                let key = format!("user_htlcs_{}", user);
                Vector::new(key.as_bytes())
            });
        user_htlcs.push(&htlc_id.to_string());
        self.user_htlcs.insert(user, &user_htlcs);
    }

    fn remove_from_active(&mut self, htlc_id: &str) {
        let mut new_active = Vector::new(StorageKey::ActiveHTLCs);
        for i in 0..self.active_htlcs.len() {
            let id = self.active_htlcs.get(i).unwrap();
            if id != htlc_id {
                new_active.push(&id);
            }
        }
        self.active_htlcs = new_active;
    }

    fn all_fills_completed(&self, htlc_id: &str) -> bool {
        self.partial_fills.get(&htlc_id.to_string())
            .map(|fills| {
                fills.iter().all(|fill| fill.status == FillStatus::Completed)
            })
            .unwrap_or(true)
    }

    fn get_fills_key(htlc_id: &str) -> Vec<u8> {
        format!("fills_{}", htlc_id).into_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    #[test]
    fn test_create_and_withdraw_htlc() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_near(1))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionPlusContract::new();

        let secret = "mysecret";
        let mut hasher = Sha256::new();
        hasher.update(secret.as_bytes());
        let hashlock = hex::encode(hasher.finalize());

        let htlc_id = contract.create_htlc(
            accounts(2),
            hashlock.clone(),
            3600,
            false,
            None,
            false,
        );

        assert!(contract.get_htlc(htlc_id.clone()).is_some());
        assert!(contract.can_withdraw(htlc_id.clone()));

        // Switch to receiver
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(2))
            .block_timestamp(1_000_000_000_000_000_000 + 1800_000_000_000)
            .build());

        contract.withdraw(htlc_id.clone(), hex::encode(secret));
        
        let htlc = contract.get_htlc(htlc_id).unwrap();
        assert_eq!(htlc.status, HTLCStatus::Completed);
    }

    #[test]
    fn test_partial_fills() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_near(10))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionPlusContract::new();
        let hashlock = hex::encode([1u8; 32]);

        let htlc_id = contract.create_htlc(
            accounts(2),
            hashlock,
            3600,
            true,
            Some(U128(NearToken::from_near(1).as_yoctonear())),
            false,
        );

        // Create partial fill
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3))
            .attached_deposit(NearToken::from_near(3))
            .block_timestamp(1_000_000_000_000_000_000)
            .build());

        let fill_id = contract.create_partial_fill(
            htlc_id.clone(),
            U128(NearToken::from_near(3).as_yoctonear()),
        );

        let fills = contract.get_partial_fills(htlc_id.clone());
        assert_eq!(fills.len(), 1);
        assert_eq!(fills[0].amount.0, NearToken::from_near(3).as_yoctonear());
    }
}