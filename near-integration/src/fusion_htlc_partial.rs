use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::{LookupMap, UnorderedMap, Vector};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{
    env, near_bindgen, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    Promise,
};
use sha2::{Digest, Sha256};

// This is an enhanced version with partial fills support

// Safety deposit structure (from base contract)
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct SafetyDeposit {
    pub id: String,
    pub htlc_id: String,
    pub resolver: AccountId,
    pub amount: U128,
    pub created_at: U64,
}

// Storage keys
#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    HTLCs,
    SafetyDeposits,
    SecretToHTLC,
    PartialFills,
    FillerToHTLC,
}

// Partial fill structure
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct PartialFill {
    pub fill_id: String,
    pub htlc_id: String,
    pub filler: AccountId,
    pub amount: U128,
    pub secret_hash: String,
    pub secret: Option<String>,
    pub claimed: bool,
    pub created_at: U64,
}

// Enhanced HTLC with partial fills support
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct HTLCPartial {
    pub id: String,
    pub sender: AccountId,
    pub receiver: AccountId,
    pub token_id: Option<AccountId>,
    pub total_amount: U128,
    pub remaining_amount: U128,
    pub min_fill_amount: U128,
    pub hashlock: String,
    pub timelock: U64,
    pub allow_partial_fills: bool,
    pub fills: Vec<String>, // Fill IDs
    pub withdrawn: bool,
    pub refunded: bool,
    pub created_at: U64,
}

// Events for partial fills
#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PartialFillCreatedEvent {
    pub fill_id: String,
    pub htlc_id: String,
    pub filler: AccountId,
    pub amount: U128,
    pub secret_hash: String,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PartialFillClaimedEvent {
    pub fill_id: String,
    pub secret: String,
    pub claimed_by: AccountId,
}

// Enhanced contract with partial fills
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct FusionHTLCPartialContract {
    htlcs: UnorderedMap<String, HTLCPartial>,
    partial_fills: UnorderedMap<String, PartialFill>,
    safety_deposits: UnorderedMap<String, SafetyDeposit>,
    secret_to_htlc: LookupMap<String, String>,
    filler_to_htlc: LookupMap<AccountId, Vector<String>>,
    next_htlc_id: u64,
    next_fill_id: u64,
    next_deposit_id: u64,
}

#[near_bindgen]
impl FusionHTLCPartialContract {
    #[init]
    pub fn new() -> Self {
        Self {
            htlcs: UnorderedMap::new(StorageKey::HTLCs),
            partial_fills: UnorderedMap::new(StorageKey::PartialFills),
            safety_deposits: UnorderedMap::new(StorageKey::SafetyDeposits),
            secret_to_htlc: LookupMap::new(StorageKey::SecretToHTLC),
            filler_to_htlc: LookupMap::new(StorageKey::FillerToHTLC),
            next_htlc_id: 1,
            next_fill_id: 1,
            next_deposit_id: 1,
        }
    }

    // Create HTLC with partial fills support
    #[payable]
    pub fn create_htlc_partial(
        &mut self,
        receiver: AccountId,
        hashlock: String,
        timelock_seconds: u64,
        allow_partial_fills: bool,
        min_fill_amount: U128,
    ) -> String {
        let sender = env::predecessor_account_id();
        let amount = env::attached_deposit();
        let current_time = env::block_timestamp() / 1_000_000_000;

        // Validate inputs
        require!(amount > NearToken::from_yoctonear(0), "Amount must be greater than 0");
        require!(
            hashlock.len() == 64, // SHA-256 hex string
            "Invalid hashlock length"
        );
        require!(
            timelock_seconds >= 3600 && timelock_seconds <= 2592000,
            "Timelock must be between 1 hour and 30 days"
        );

        if allow_partial_fills {
            require!(
                min_fill_amount.0 > 0 && min_fill_amount.0 <= amount.as_yoctonear(),
                "Invalid minimum fill amount"
            );
        }

        let timelock = current_time + timelock_seconds;
        let htlc_id = format!("htlc_{}", self.next_htlc_id);
        self.next_htlc_id += 1;

        let htlc = HTLCPartial {
            id: htlc_id.clone(),
            sender: sender.clone(),
            receiver: receiver.clone(),
            token_id: None,
            total_amount: U128(amount.as_yoctonear()),
            remaining_amount: U128(amount.as_yoctonear()),
            min_fill_amount: if allow_partial_fills {
                min_fill_amount
            } else {
                U128(amount.as_yoctonear())
            },
            hashlock: hashlock.clone(),
            timelock: U64(timelock),
            allow_partial_fills,
            fills: Vec::new(),
            withdrawn: false,
            refunded: false,
            created_at: U64(current_time),
        };

        self.htlcs.insert(&htlc_id, &htlc);
        self.secret_to_htlc.insert(&hashlock, &htlc_id);

        env::log_str(&format!(
            "HTLCPartialCreated: {} {} {} {} {}",
            htlc_id, sender, receiver, amount, allow_partial_fills
        ));

        htlc_id
    }

    // Create a partial fill for an HTLC
    #[payable]
    pub fn create_partial_fill(
        &mut self,
        htlc_id: String,
        fill_amount: U128,
    ) -> String {
        let filler = env::predecessor_account_id();
        let attached = env::attached_deposit();
        let current_time = env::block_timestamp() / 1_000_000_000;

        let mut htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");

        // Validate
        require!(htlc.allow_partial_fills, "Partial fills not allowed");
        require!(!htlc.withdrawn, "HTLC already withdrawn");
        require!(!htlc.refunded, "HTLC already refunded");
        require!(current_time < htlc.timelock.0, "HTLC expired");
        require!(
            fill_amount.0 >= htlc.min_fill_amount.0,
            "Fill amount below minimum"
        );
        require!(
            fill_amount.0 <= htlc.remaining_amount.0,
            "Fill amount exceeds remaining"
        );
        require!(attached >= NearToken::from_yoctonear(fill_amount.0), "Insufficient deposit");

        // Generate unique secret hash for this fill
        let fill_secret_data = format!("{}_{}_{}", htlc_id, filler, self.next_fill_id);
        let mut hasher = Sha256::new();
        hasher.update(fill_secret_data.as_bytes());
        let fill_secret_hash = hex::encode(hasher.finalize());

        let fill_id = format!("fill_{}", self.next_fill_id);
        self.next_fill_id += 1;

        let partial_fill = PartialFill {
            fill_id: fill_id.clone(),
            htlc_id: htlc_id.clone(),
            filler: filler.clone(),
            amount: fill_amount,
            secret_hash: fill_secret_hash.clone(),
            secret: None,
            claimed: false,
            created_at: U64(current_time),
        };

        // Update HTLC
        htlc.remaining_amount = U128(htlc.remaining_amount.0 - fill_amount.0);
        htlc.fills.push(fill_id.clone());
        self.htlcs.insert(&htlc_id, &htlc);

        // Store fill
        self.partial_fills.insert(&fill_id, &partial_fill);

        // Track filler's fills
        let mut filler_fills = self
            .filler_to_htlc
            .get(&filler)
            .unwrap_or_else(|| Vector::new(b"f"));
        filler_fills.push(&fill_id);
        self.filler_to_htlc.insert(&filler, &filler_fills);

        // Return excess deposit
        if attached > NearToken::from_yoctonear(fill_amount.0) {
            Promise::new(filler.clone()).transfer(attached.saturating_sub(NearToken::from_yoctonear(fill_amount.0)));
        }

        env::log_str(
            &serde_json::to_string(&PartialFillCreatedEvent {
                fill_id: fill_id.clone(),
                htlc_id,
                filler,
                amount: fill_amount,
                secret_hash: fill_secret_hash,
            })
            .unwrap(),
        );

        fill_id
    }

    // Withdraw a specific partial fill
    pub fn withdraw_partial_fill(
        &mut self,
        fill_id: String,
        secret: String,
    ) -> Promise {
        let mut fill = self
            .partial_fills
            .get(&fill_id)
            .expect("Fill not found");
        let htlc = self.htlcs.get(&fill.htlc_id).expect("HTLC not found");
        let withdrawer = env::predecessor_account_id();
        let current_time = env::block_timestamp() / 1_000_000_000;

        // Validate
        require!(!fill.claimed, "Fill already claimed");
        require!(withdrawer == htlc.receiver, "Not the receiver");
        require!(current_time < htlc.timelock.0, "HTLC expired");

        // Verify main secret
        let secret_bytes = hex::decode(&secret).expect("Invalid hex secret");
        let mut hasher = Sha256::new();
        hasher.update(&secret_bytes);
        let secret_hash = hex::encode(hasher.finalize());
        require!(secret_hash == htlc.hashlock, "Invalid secret");

        // Update fill
        fill.claimed = true;
        fill.secret = Some(secret.clone());
        self.partial_fills.insert(&fill_id, &fill);

        // Mark HTLC as withdrawn if all fills are claimed
        let all_claimed = htlc.fills.iter().all(|fid| {
            self.partial_fills
                .get(fid)
                .map(|f| f.claimed)
                .unwrap_or(false)
        });

        if all_claimed && htlc.remaining_amount.0 == 0 {
            let mut updated_htlc = htlc.clone();
            updated_htlc.withdrawn = true;
            self.htlcs.insert(&fill.htlc_id, &updated_htlc);
        }

        env::log_str(
            &serde_json::to_string(&PartialFillClaimedEvent {
                fill_id,
                secret,
                claimed_by: withdrawer.clone(),
            })
            .unwrap(),
        );

        // Transfer funds
        Promise::new(withdrawer).transfer(NearToken::from_yoctonear(fill.amount.0))
    }

    // Refund unclaimed partial fills after timeout
    pub fn refund_partial_fill(&mut self, fill_id: String) -> Promise {
        let fill = self
            .partial_fills
            .get(&fill_id)
            .expect("Fill not found");
        let htlc = self.htlcs.get(&fill.htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        let refunder = env::predecessor_account_id();

        // Validate
        require!(!fill.claimed, "Fill already claimed");
        require!(current_time >= htlc.timelock.0, "HTLC not expired");
        require!(refunder == fill.filler, "Not the filler");

        // Remove fill
        self.partial_fills.remove(&fill_id);

        // Update HTLC remaining amount
        let mut updated_htlc = htlc.clone();
        updated_htlc.remaining_amount = U128(updated_htlc.remaining_amount.0 + fill.amount.0);
        updated_htlc.fills.retain(|fid| fid != &fill_id);
        self.htlcs.insert(&fill.htlc_id, &updated_htlc);

        // Transfer refund
        Promise::new(refunder).transfer(NearToken::from_yoctonear(fill.amount.0))
    }

    // View functions
    pub fn get_htlc_partial(&self, htlc_id: String) -> Option<HTLCPartial> {
        self.htlcs.get(&htlc_id)
    }

    pub fn get_partial_fill(&self, fill_id: String) -> Option<PartialFill> {
        self.partial_fills.get(&fill_id)
    }

    pub fn get_htlc_fills(&self, htlc_id: String) -> Vec<PartialFill> {
        if let Some(htlc) = self.htlcs.get(&htlc_id) {
            htlc.fills
                .iter()
                .filter_map(|fill_id| self.partial_fills.get(fill_id))
                .collect()
        } else {
            Vec::new()
        }
    }

    pub fn get_filler_fills(&self, filler: AccountId) -> Vec<PartialFill> {
        if let Some(fill_ids) = self.filler_to_htlc.get(&filler) {
            fill_ids
                .iter()
                .filter_map(|fill_id| self.partial_fills.get(&fill_id))
                .collect()
        } else {
            Vec::new()
        }
    }
}