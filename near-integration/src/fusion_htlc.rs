use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, near_bindgen, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise,
};
use sha2::{Digest, Sha256};

// Constants
const MIN_TIMELOCK_DURATION: u64 = 3600; // 1 hour in seconds
const MAX_TIMELOCK_DURATION: u64 = 2592000; // 30 days in seconds
const HASH_LENGTH: usize = 32; // SHA-256 hash length
const TGAS: u64 = 1_000_000_000_000;

// Storage keys
#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    HTLCs,
    SafetyDeposits,
    SecretToHTLC,
}

// Contract Types
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct HTLC {
    pub id: String,
    pub sender: AccountId,
    pub receiver: AccountId,
    pub token_id: Option<AccountId>, // None for NEAR, Some for NEP-141 tokens
    pub amount: U128,
    pub hashlock: String, // Hex encoded hash
    pub timelock: U64,
    pub secret: Option<String>, // Revealed secret
    pub withdrawn: bool,
    pub refunded: bool,
    pub created_at: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct SafetyDeposit {
    pub id: String,
    pub htlc_id: String,
    pub resolver: AccountId,
    pub amount: U128,
    pub created_at: U64,
}

// Note: In production, would use proper NEP-141 token standard interfaces

// Main contract
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct FusionHTLCContract {
    htlcs: UnorderedMap<String, HTLC>,
    safety_deposits: UnorderedMap<String, SafetyDeposit>,
    secret_to_htlc: LookupMap<String, String>, // Maps secret hash to HTLC ID
    next_htlc_id: u64,
    next_deposit_id: u64,
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
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HTLCWithdrawnEvent {
    pub htlc_id: String,
    pub secret: String,
    pub withdrawn_by: AccountId,
    pub withdrawn_at: U64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HTLCRefundedEvent {
    pub htlc_id: String,
    pub refunded_to: AccountId,
    pub refunded_at: U64,
}

// Implementation
#[near_bindgen]
impl FusionHTLCContract {
    #[init]
    pub fn new() -> Self {
        Self {
            htlcs: UnorderedMap::new(StorageKey::HTLCs),
            safety_deposits: UnorderedMap::new(StorageKey::SafetyDeposits),
            secret_to_htlc: LookupMap::new(StorageKey::SecretToHTLC),
            next_htlc_id: 1,
            next_deposit_id: 1,
        }
    }

    // Create HTLC for NEAR tokens
    #[payable]
    pub fn create_htlc(
        &mut self,
        receiver: AccountId,
        hashlock: String,
        timelock_seconds: u64,
    ) -> String {
        let sender = env::predecessor_account_id();
        let amount = env::attached_deposit();
        let current_time = env::block_timestamp() / 1_000_000_000; // Convert to seconds

        // Validate inputs
        require!(amount > NearToken::from_yoctonear(0), "Amount must be greater than 0");
        require!(
            hashlock.len() == HASH_LENGTH * 2,
            "Invalid hashlock length"
        );
        require!(
            timelock_seconds >= MIN_TIMELOCK_DURATION,
            "Timelock too short"
        );
        require!(
            timelock_seconds <= MAX_TIMELOCK_DURATION,
            "Timelock too long"
        );

        let timelock = current_time + timelock_seconds;
        let htlc_id = format!("htlc_{}", self.next_htlc_id);
        self.next_htlc_id += 1;

        let htlc = HTLC {
            id: htlc_id.clone(),
            sender: sender.clone(),
            receiver: receiver.clone(),
            token_id: None,
            amount: U128(amount.as_yoctonear()),
            hashlock: hashlock.clone(),
            timelock: U64(timelock),
            secret: None,
            withdrawn: false,
            refunded: false,
            created_at: U64(current_time),
        };

        self.htlcs.insert(&htlc_id, &htlc);
        self.secret_to_htlc.insert(&hashlock, &htlc_id);

        // Emit event
        env::log_str(
            &serde_json::to_string(&HTLCCreatedEvent {
                htlc_id: htlc_id.clone(),
                sender,
                receiver,
                amount: U128(amount.as_yoctonear()),
                hashlock,
                timelock: U64(timelock),
            })
            .unwrap(),
        );

        htlc_id
    }

    // Create HTLC for NEP-141 tokens
    pub fn create_token_htlc(
        &mut self,
        token_id: AccountId,
        amount: U128,
        receiver: AccountId,
        hashlock: String,
        timelock_seconds: u64,
    ) -> String {
        let sender = env::predecessor_account_id();
        let current_time = env::block_timestamp() / 1_000_000_000;

        // Validate inputs
        require!(amount.0 > 0, "Amount must be greater than 0");
        require!(
            hashlock.len() == HASH_LENGTH * 2,
            "Invalid hashlock length"
        );
        require!(
            timelock_seconds >= MIN_TIMELOCK_DURATION,
            "Timelock too short"
        );
        require!(
            timelock_seconds <= MAX_TIMELOCK_DURATION,
            "Timelock too long"
        );

        let timelock = current_time + timelock_seconds;
        let htlc_id = format!("htlc_{}", self.next_htlc_id);
        self.next_htlc_id += 1;

        let htlc = HTLC {
            id: htlc_id.clone(),
            sender: sender.clone(),
            receiver: receiver.clone(),
            token_id: Some(token_id.clone()),
            amount,
            hashlock: hashlock.clone(),
            timelock: U64(timelock),
            secret: None,
            withdrawn: false,
            refunded: false,
            created_at: U64(current_time),
        };

        self.htlcs.insert(&htlc_id, &htlc);
        self.secret_to_htlc.insert(&hashlock, &htlc_id);

        // Note: Actual token transfer would be handled via ft_transfer_call
        // The tokens should be transferred to this contract before calling this method

        env::log_str(
            &serde_json::to_string(&HTLCCreatedEvent {
                htlc_id: htlc_id.clone(),
                sender,
                receiver,
                amount,
                hashlock,
                timelock: U64(timelock),
            })
            .unwrap(),
        );

        htlc_id
    }

    // Withdraw funds by providing the correct secret
    pub fn withdraw(&mut self, htlc_id: String, secret: String) -> Promise {
        let htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        let withdrawer = env::predecessor_account_id();

        // Validate state
        require!(!htlc.withdrawn, "Already withdrawn");
        require!(!htlc.refunded, "Already refunded");
        require!(current_time < htlc.timelock.0, "HTLC expired");
        require!(withdrawer == htlc.receiver, "Not the receiver");

        // Verify secret
        let secret_bytes = hex::decode(&secret).expect("Invalid hex secret");
        let mut hasher = Sha256::new();
        hasher.update(&secret_bytes);
        let secret_hash = hex::encode(hasher.finalize());

        require!(secret_hash == htlc.hashlock, "Invalid secret");

        // Update state
        let mut updated_htlc = htlc.clone();
        updated_htlc.withdrawn = true;
        updated_htlc.secret = Some(secret.clone());
        self.htlcs.insert(&htlc_id, &updated_htlc);

        // Emit event
        env::log_str(
            &serde_json::to_string(&HTLCWithdrawnEvent {
                htlc_id: htlc_id.clone(),
                secret,
                withdrawn_by: withdrawer.clone(),
                withdrawn_at: U64(current_time),
            })
            .unwrap(),
        );

        // Transfer funds
        if let Some(token_id) = htlc.token_id {
            // NEP-141 token transfer
            Promise::new(token_id).function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&serde_json::json!({
                    "receiver_id": withdrawer,
                    "amount": htlc.amount,
                    "memo": Some(format!("HTLC withdraw: {}", htlc_id))
                }))
                .unwrap(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(5),
            )
        } else {
            // NEAR transfer
            Promise::new(withdrawer).transfer(NearToken::from_yoctonear(htlc.amount.0))
        }
    }

    // Refund funds after timeout
    pub fn refund(&mut self, htlc_id: String) -> Promise {
        let htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        let refunder = env::predecessor_account_id();

        // Validate state
        require!(!htlc.withdrawn, "Already withdrawn");
        require!(!htlc.refunded, "Already refunded");
        require!(current_time >= htlc.timelock.0, "HTLC not expired");
        require!(refunder == htlc.sender, "Not the sender");

        // Update state
        let mut updated_htlc = htlc.clone();
        updated_htlc.refunded = true;
        self.htlcs.insert(&htlc_id, &updated_htlc);

        // Emit event
        env::log_str(
            &serde_json::to_string(&HTLCRefundedEvent {
                htlc_id: htlc_id.clone(),
                refunded_to: refunder.clone(),
                refunded_at: U64(current_time),
            })
            .unwrap(),
        );

        // Transfer funds back
        if let Some(token_id) = htlc.token_id {
            // NEP-141 token transfer
            Promise::new(token_id).function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&serde_json::json!({
                    "receiver_id": refunder,
                    "amount": htlc.amount,
                    "memo": Some(format!("HTLC refund: {}", htlc_id))
                }))
                .unwrap(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(5),
            )
        } else {
            // NEAR transfer
            Promise::new(refunder).transfer(NearToken::from_yoctonear(htlc.amount.0))
        }
    }

    // Create safety deposit for resolver
    #[payable]
    pub fn create_safety_deposit(&mut self, htlc_id: String) -> String {
        let resolver = env::predecessor_account_id();
        let amount = env::attached_deposit();
        let current_time = env::block_timestamp() / 1_000_000_000;

        require!(
            self.htlcs.get(&htlc_id).is_some(),
            "HTLC does not exist"
        );
        require!(amount > NearToken::from_yoctonear(0), "Deposit amount must be greater than 0");

        let deposit_id = format!("deposit_{}", self.next_deposit_id);
        self.next_deposit_id += 1;

        let safety_deposit = SafetyDeposit {
            id: deposit_id.clone(),
            htlc_id,
            resolver,
            amount: U128(amount.as_yoctonear()),
            created_at: U64(current_time),
        };

        self.safety_deposits.insert(&deposit_id, &safety_deposit);

        deposit_id
    }

    // Claim safety deposit
    pub fn claim_safety_deposit(&mut self, deposit_id: String) -> Promise {
        let deposit = self
            .safety_deposits
            .get(&deposit_id)
            .expect("Deposit not found");
        let claimer = env::predecessor_account_id();

        require!(claimer == deposit.resolver, "Not the resolver");

        // Remove deposit
        self.safety_deposits.remove(&deposit_id);

        // Transfer deposit back
        Promise::new(claimer).transfer(NearToken::from_yoctonear(deposit.amount.0))
    }

    // View functions
    pub fn get_htlc(&self, htlc_id: String) -> Option<HTLC> {
        self.htlcs.get(&htlc_id)
    }

    pub fn get_htlc_by_hashlock(&self, hashlock: String) -> Option<HTLC> {
        if let Some(htlc_id) = self.secret_to_htlc.get(&hashlock) {
            self.htlcs.get(&htlc_id)
        } else {
            None
        }
    }

    pub fn can_withdraw(&self, htlc_id: String) -> bool {
        if let Some(htlc) = self.htlcs.get(&htlc_id) {
            let current_time = env::block_timestamp() / 1_000_000_000;
            !htlc.withdrawn && !htlc.refunded && current_time < htlc.timelock.0
        } else {
            false
        }
    }

    pub fn can_refund(&self, htlc_id: String) -> bool {
        if let Some(htlc) = self.htlcs.get(&htlc_id) {
            let current_time = env::block_timestamp() / 1_000_000_000;
            !htlc.withdrawn && !htlc.refunded && current_time >= htlc.timelock.0
        } else {
            false
        }
    }

    pub fn get_safety_deposit(&self, deposit_id: String) -> Option<SafetyDeposit> {
        self.safety_deposits.get(&deposit_id)
    }

    // Callback for NEP-141 token transfers
    pub fn ft_on_transfer(
        &mut self,
        _sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> U128 {
        // Parse message to determine action
        let params: serde_json::Value = serde_json::from_str(&msg).expect("Invalid message");
        
        if let Some(action) = params.get("action").and_then(|v| v.as_str()) {
            match action {
                "create_htlc" => {
                    let receiver = params["receiver"]
                        .as_str()
                        .expect("Missing receiver")
                        .parse()
                        .expect("Invalid receiver");
                    let hashlock = params["hashlock"]
                        .as_str()
                        .expect("Missing hashlock")
                        .to_string();
                    let timelock_seconds = params["timelock_seconds"]
                        .as_u64()
                        .expect("Missing timelock");

                    self.create_token_htlc(
                        env::predecessor_account_id(),
                        amount,
                        receiver,
                        hashlock,
                        timelock_seconds,
                    );
                    
                    // Return 0 to indicate all tokens were used
                    U128(0)
                }
                _ => {
                    env::panic_str("Unknown action");
                }
            }
        } else {
            env::panic_str("Missing action in message");
        }
    }
}

// Tests
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, VMContext};

    fn get_context(predecessor: AccountId) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(predecessor)
            .block_timestamp(1_000_000_000_000_000_000) // 1 second in nanoseconds
            .build()
    }

    #[test]
    fn test_create_and_withdraw_htlc() {
        let mut context = get_context(accounts(1));
        context.attached_deposit = NearToken::from_yoctonear(1_000_000_000_000_000_000_000_000); // 1 NEAR
        testing_env!(context);

        let mut contract = FusionHTLCContract::new();

        // Create secret and hash
        let secret = "my_secret_value";
        let secret_bytes = secret.as_bytes();
        let mut hasher = Sha256::new();
        hasher.update(secret_bytes);
        let hashlock = hex::encode(hasher.finalize());

        // Create HTLC
        let htlc_id = contract.create_htlc(accounts(2), hashlock.clone(), 3600);

        // Check HTLC created
        let htlc = contract.get_htlc(htlc_id.clone()).unwrap();
        assert_eq!(htlc.sender, accounts(1));
        assert_eq!(htlc.receiver, accounts(2));
        assert_eq!(htlc.amount.0, 1_000_000_000_000_000_000_000_000);

        // Switch to receiver and withdraw
        testing_env!(get_context(accounts(2)));
        let secret_hex = hex::encode(secret_bytes);
        contract.withdraw(htlc_id.clone(), secret_hex);

        // Check HTLC withdrawn
        let htlc = contract.get_htlc(htlc_id).unwrap();
        assert!(htlc.withdrawn);
        assert!(htlc.secret.is_some());
    }

    #[test]
    fn test_refund_after_timeout() {
        let mut context = get_context(accounts(1));
        context.attached_deposit = NearToken::from_yoctonear(1_000_000_000_000_000_000_000_000); // 1 NEAR
        testing_env!(context);

        let mut contract = FusionHTLCContract::new();

        // Create HTLC
        let hashlock = hex::encode([0u8; 32]);
        let htlc_id = contract.create_htlc(accounts(2), hashlock, 3600);

        // Fast forward time
        let mut context = get_context(accounts(1));
        context.block_timestamp = 2 * 3600 * 1_000_000_000; // 2 hours later
        testing_env!(context);

        // Refund
        contract.refund(htlc_id.clone());

        // Check HTLC refunded
        let htlc = contract.get_htlc(htlc_id).unwrap();
        assert!(htlc.refunded);
    }
}