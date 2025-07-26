use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, log
};

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HTLC {
    pub id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub amount: i128,
    pub token: Address,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub withdrawn: bool,
    pub refunded: bool,
}

#[contracttype]
pub enum DataKey {
    HTLC(u64),
    Counter,
}

#[contract]
pub struct SimpleHTLCContract;

#[contractimpl]
impl SimpleHTLCContract {
    /// Create a new simple HTLC
    pub fn create_simple_htlc(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        amount: i128,
        hashlock: BytesN<32>,
        timelock: u64,
    ) -> u64 {
        sender.require_auth();
        
        // Get and increment counter
        let mut counter: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        counter += 1;
        env.storage().instance().set(&DataKey::Counter, &counter);
        
        // Transfer tokens to contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);
        
        // Create HTLC
        let htlc = HTLC {
            id: counter,
            sender: sender.clone(),
            receiver: receiver.clone(),
            amount,
            token,
            hashlock,
            timelock,
            withdrawn: false,
            refunded: false,
        };
        
        // Store HTLC
        env.storage().persistent().set(&DataKey::HTLC(counter), &htlc);
        
        // Log event
        log!(&env, "HTLC created: {}", counter);
        
        counter
    }
    
    /// Withdraw funds by revealing the secret
    pub fn withdraw(env: Env, htlc_id: u64, secret: BytesN<32>) {
        // Get HTLC
        let mut htlc: HTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Check conditions
        assert!(!htlc.withdrawn, "Already withdrawn");
        assert!(!htlc.refunded, "Already refunded");
        assert!(env.ledger().timestamp() < htlc.timelock, "Timelock expired");
        
        // Verify secret
        // Convert BytesN to Bytes for hashing
        let secret_bytes = soroban_sdk::Bytes::from(secret.clone());
        let computed_hash = env.crypto().keccak256(&secret_bytes);
        let computed_hash_bytes: BytesN<32> = computed_hash.into();
        assert!(computed_hash_bytes == htlc.hashlock, "Invalid secret");
        
        // Require receiver auth
        htlc.receiver.require_auth();
        
        // Transfer tokens
        let token_client = token::Client::new(&env, &htlc.token);
        token_client.transfer(
            &env.current_contract_address(),
            &htlc.receiver,
            &htlc.amount
        );
        
        // Update state
        htlc.withdrawn = true;
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        log!(&env, "HTLC withdrawn: {}", htlc_id);
    }
    
    /// Refund after timelock expires
    pub fn refund(env: Env, htlc_id: u64) {
        // Get HTLC
        let mut htlc: HTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Check conditions
        assert!(!htlc.withdrawn, "Already withdrawn");
        assert!(!htlc.refunded, "Already refunded");
        assert!(env.ledger().timestamp() >= htlc.timelock, "Timelock not expired");
        
        // Require sender auth
        htlc.sender.require_auth();
        
        // Transfer tokens back
        let token_client = token::Client::new(&env, &htlc.token);
        token_client.transfer(
            &env.current_contract_address(),
            &htlc.sender,
            &htlc.amount
        );
        
        // Update state
        htlc.refunded = true;
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        log!(&env, "HTLC refunded: {}", htlc_id);
    }
    
    /// Get HTLC details
    pub fn get_htlc(env: Env, htlc_id: u64) -> Option<HTLC> {
        env.storage().persistent().get(&DataKey::HTLC(htlc_id))
    }
}