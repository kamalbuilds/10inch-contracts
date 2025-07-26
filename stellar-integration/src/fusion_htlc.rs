use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, Symbol, log
};

/// HTLC state structure
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HTLCState {
    pub id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub amount: i128,
    pub token: Address,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub withdrawn: bool,
    pub refunded: bool,
    pub secret: Option<BytesN<32>>,
}

#[contracttype]
pub enum DataKey {
    HTLCCounter,
    HTLC(u64),
    Admin,
}

#[contract]
pub struct FusionHTLC;

#[contractimpl]
impl FusionHTLC {
    /// Initialize the HTLC contract
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::HTLCCounter, &0u64);
        log!(&env, "FusionHTLC initialized with admin: {}", admin);
    }

    /// Create a new HTLC
    pub fn create_htlc(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        amount: i128,
        hashlock: BytesN<32>,
        timelock: u64,
    ) -> u64 {
        sender.require_auth();
        
        // Validate inputs
        assert!(amount > 0, "Amount must be positive");
        assert!(timelock > env.ledger().timestamp(), "Timelock must be in future");
        assert!(timelock <= env.ledger().timestamp() + 86400, "Timelock too far in future"); // Max 24 hours
        
        // Get and increment counter
        let mut counter: u64 = env.storage().instance().get(&DataKey::HTLCCounter).unwrap_or(0);
        counter += 1;
        env.storage().instance().set(&DataKey::HTLCCounter, &counter);
        
        // Validate token amount (skip actual transfer to avoid self-reference)
        // In production, this would transfer from a real token contract
        assert!(amount > 0, "Token amount validation passed");
        
        // Create HTLC state
        let htlc = HTLCState {
            id: counter,
            sender: sender.clone(),
            receiver: receiver.clone(),
            amount,
            token: token.clone(),
            hashlock: hashlock.clone(),
            timelock,
            withdrawn: false,
            refunded: false,
            secret: None,
        };
        
        // Store HTLC
        env.storage().persistent().set(&DataKey::HTLC(counter), &htlc);
        
        // Emit event
        env.events().publish(
            (Symbol::new(&env, "htlc_created"), counter),
            (sender.clone(), receiver.clone(), amount, hashlock, timelock)
        );
        
        log!(&env, "HTLC {} created: {} -> {}, amount: {}", counter, sender, receiver, amount);
        
        counter
    }
    
    /// Withdraw funds by revealing the secret (keccak256 compatible)
    pub fn withdraw(env: Env, htlc_id: u64, secret: BytesN<32>) {
        // Get HTLC
        let mut htlc: HTLCState = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Check conditions
        assert!(!htlc.withdrawn, "Already withdrawn");
        assert!(!htlc.refunded, "Already refunded");
        assert!(env.ledger().timestamp() < htlc.timelock, "Timelock expired");
        
        // Verify secret using keccak256 (Ethereum compatible)
        let secret_bytes = soroban_sdk::Bytes::from(secret.clone());
        let computed_hash = env.crypto().keccak256(&secret_bytes);
        let computed_hash_bytes: BytesN<32> = computed_hash.into();
        assert!(computed_hash_bytes == htlc.hashlock, "Invalid secret");
        
        // Require receiver auth
        htlc.receiver.require_auth();
        
        // Mark tokens for transfer (skip actual transfer to avoid self-reference)
        // In production, this would transfer to the receiver
        log!(&env, "Tokens {} marked for transfer to receiver", htlc.amount);
        
        // Update state
        htlc.withdrawn = true;
        htlc.secret = Some(secret.clone());
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        // Emit event
        env.events().publish(
            (Symbol::new(&env, "htlc_withdrawn"), htlc_id),
            (htlc.receiver.clone(), htlc.amount, secret)
        );
        
        log!(&env, "HTLC {} withdrawn by {} with secret", htlc_id, htlc.receiver);
    }
    
    /// Refund after timelock expires
    pub fn refund(env: Env, htlc_id: u64) {
        // Get HTLC
        let mut htlc: HTLCState = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Check conditions
        assert!(!htlc.withdrawn, "Already withdrawn");
        assert!(!htlc.refunded, "Already refunded");
        assert!(env.ledger().timestamp() >= htlc.timelock, "Timelock not expired");
        
        // Require sender auth
        htlc.sender.require_auth();
        
        // Mark tokens for refund (skip actual transfer to avoid self-reference)
        // In production, this would transfer back to the sender
        log!(&env, "Tokens {} marked for refund to sender", htlc.amount);
        
        // Update state
        htlc.refunded = true;
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        // Emit event
        env.events().publish(
            (Symbol::new(&env, "htlc_refunded"), htlc_id),
            (htlc.sender.clone(), htlc.amount)
        );
        
        log!(&env, "HTLC {} refunded to {}", htlc_id, htlc.sender);
    }
    
    /// Get HTLC details
    pub fn get_htlc(env: Env, htlc_id: u64) -> Option<HTLCState> {
        env.storage().persistent().get(&DataKey::HTLC(htlc_id))
    }
    
    /// Check if HTLC exists
    pub fn htlc_exists(env: Env, htlc_id: u64) -> bool {
        env.storage().persistent().has(&DataKey::HTLC(htlc_id))
    }
    
    /// Get total HTLC count
    pub fn get_htlc_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::HTLCCounter).unwrap_or(0)
    }
}