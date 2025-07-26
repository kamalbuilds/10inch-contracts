use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::collections::UnorderedMap;
use near_sdk::{
    env, near_bindgen, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    Promise,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// Constants
const MIN_TIMELOCK: u64 = 3600; // 1 hour
const MAX_TIMELOCK: u64 = 2592000; // 30 days

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    HTLCs,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct HTLCInfo {
    pub sender: AccountId,
    pub receiver: AccountId,
    pub amount: U128,
    pub hashlock: String,
    pub timelock: U64,
    pub secret: Option<String>,
    pub withdrawn: bool,
    pub refunded: bool,
}

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct FusionHTLC {
    htlcs: UnorderedMap<String, HTLCInfo>,
    next_id: u64,
}

#[near_bindgen]
impl FusionHTLC {
    #[init]
    pub fn new() -> Self {
        Self {
            htlcs: UnorderedMap::new(StorageKey::HTLCs),
            next_id: 1,
        }
    }

    #[payable]
    pub fn create_htlc(
        &mut self,
        receiver: AccountId,
        hashlock: String,
        timelock_seconds: u64,
    ) -> String {
        let amount = env::attached_deposit();
        require!(amount > NearToken::from_yoctonear(0), "Amount must be greater than 0");
        require!(hashlock.len() == 64, "Invalid hashlock");
        require!(timelock_seconds >= MIN_TIMELOCK && timelock_seconds <= MAX_TIMELOCK, "Invalid timelock");

        let current_time = env::block_timestamp() / 1_000_000_000;
        let htlc_id = format!("htlc_{}", self.next_id);
        self.next_id += 1;

        let htlc = HTLCInfo {
            sender: env::predecessor_account_id(),
            receiver,
            amount: U128(amount.as_yoctonear()),
            hashlock,
            timelock: U64(current_time + timelock_seconds),
            secret: None,
            withdrawn: false,
            refunded: false,
        };

        self.htlcs.insert(&htlc_id, &htlc);
        env::log_str(&format!("HTLC created: {}", htlc_id));
        
        htlc_id
    }

    pub fn withdraw(&mut self, htlc_id: String, secret: String) -> Promise {
        let mut htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        
        require!(!htlc.withdrawn && !htlc.refunded, "Already processed");
        require!(env::predecessor_account_id() == htlc.receiver, "Not receiver");
        require!(current_time < htlc.timelock.0, "Expired");
        
        // Verify secret
        let secret_bytes = hex::decode(&secret).expect("Invalid hex");
        let mut hasher = Sha256::new();
        hasher.update(&secret_bytes);
        let hash = hex::encode(hasher.finalize());
        require!(hash == htlc.hashlock, "Invalid secret");

        htlc.withdrawn = true;
        htlc.secret = Some(secret);
        self.htlcs.insert(&htlc_id, &htlc);

        env::log_str(&format!("HTLC withdrawn: {}", htlc_id));
        Promise::new(htlc.receiver).transfer(NearToken::from_yoctonear(htlc.amount.0))
    }

    pub fn refund(&mut self, htlc_id: String) -> Promise {
        let mut htlc = self.htlcs.get(&htlc_id).expect("HTLC not found");
        let current_time = env::block_timestamp() / 1_000_000_000;
        
        require!(!htlc.withdrawn && !htlc.refunded, "Already processed");
        require!(env::predecessor_account_id() == htlc.sender, "Not sender");
        require!(current_time >= htlc.timelock.0, "Not expired");

        htlc.refunded = true;
        self.htlcs.insert(&htlc_id, &htlc);

        env::log_str(&format!("HTLC refunded: {}", htlc_id));
        Promise::new(htlc.sender).transfer(NearToken::from_yoctonear(htlc.amount.0))
    }

    // View methods
    pub fn htlc_exists(&self, htlc_id: String) -> bool {
        self.htlcs.get(&htlc_id).is_some()
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    #[test]
    fn test_create_and_withdraw() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_yoctonear(1_000_000_000_000_000_000_000_000))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLC::new();
        
        let secret = "mysecret";
        let mut hasher = Sha256::new();
        hasher.update(secret.as_bytes());
        let hashlock = hex::encode(hasher.finalize());

        let htlc_id = contract.create_htlc(accounts(2), hashlock.clone(), 3600);
        
        assert!(contract.htlc_exists(htlc_id.clone()));
        assert!(contract.can_withdraw(htlc_id.clone()));

        // Switch to receiver (30 minutes later, still before expiry)
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(2))
            .block_timestamp(1_000_000_000_000_000_000 + 1800_000_000_000) // 30 minutes later in nanoseconds
            .build());

        contract.withdraw(htlc_id.clone(), hex::encode(secret));
        
        assert!(!contract.can_withdraw(htlc_id.clone()));
        assert!(!contract.can_refund(htlc_id));
    }

    #[test]
    fn test_refund() {
        let context = VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_yoctonear(1_000_000_000_000_000_000_000_000))
            .block_timestamp(1_000_000_000_000_000_000)
            .build();
        testing_env!(context);

        let mut contract = FusionHTLC::new();
        let hashlock = hex::encode([0u8; 32]);
        let htlc_id = contract.create_htlc(accounts(2), hashlock, 3600);

        // Fast forward time (2 hours later, after expiry)
        testing_env!(VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(1))
            .block_timestamp(1_000_000_000_000_000_000 + 7200_000_000_000) // 2 hours later in nanoseconds
            .build());

        contract.refund(htlc_id.clone());
        
        assert!(!contract.can_withdraw(htlc_id.clone()));
        assert!(!contract.can_refund(htlc_id));
    }
}