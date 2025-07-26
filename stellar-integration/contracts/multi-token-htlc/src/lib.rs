#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, log, symbol_short, vec, Address, BytesN, Env, Symbol, Vec
};
use soroban_token_sdk::TokenClient;

#[contracttype]
#[derive(Clone, Debug)]
pub struct HTLCState {
    pub id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub amount: i128,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub withdrawn: bool,
    pub refunded: bool,
    pub secret: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TokenConfig {
    pub address: Address,
    pub symbol: Symbol,
    pub decimals: u32,
    pub enabled: bool,
    pub min_amount: i128,
    pub max_amount: i128,
}

#[contracttype]
pub enum DataKey {
    Admin,
    HTLCCounter,
    HTLC(u64),
    TokenConfig(Address),
    SupportedTokens,
    Paused,
}

#[contract]
pub struct MultiTokenHTLC;

#[contractimpl]
impl MultiTokenHTLC {
    /// Initialize the contract
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::HTLCCounter, &0u64);
        env.storage().persistent().set(&DataKey::SupportedTokens, &Vec::<Address>::new(&env));
        env.storage().persistent().set(&DataKey::Paused, &false);
    }

    /// Add a supported token
    pub fn add_token(
        env: Env,
        token: Address,
        symbol: Symbol,
        decimals: u32,
        min_amount: i128,
        max_amount: i128,
    ) {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let config = TokenConfig {
            address: token.clone(),
            symbol,
            decimals,
            enabled: true,
            min_amount,
            max_amount,
        };

        env.storage().persistent().set(&DataKey::TokenConfig(token.clone()), &config);
        
        // Add to supported tokens list
        let mut tokens: Vec<Address> = env.storage().persistent()
            .get(&DataKey::SupportedTokens)
            .unwrap_or(Vec::new(&env));
        
        if !tokens.contains(&token) {
            tokens.push_back(token);
            env.storage().persistent().set(&DataKey::SupportedTokens, &tokens);
        }

        log!(&env, "Token added: {:?}", symbol);
    }

    /// Update token configuration
    pub fn update_token(
        env: Env,
        token: Address,
        enabled: bool,
        min_amount: i128,
        max_amount: i128,
    ) {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut config: TokenConfig = env.storage().persistent()
            .get(&DataKey::TokenConfig(token.clone()))
            .expect("Token not found");

        config.enabled = enabled;
        config.min_amount = min_amount;
        config.max_amount = max_amount;

        env.storage().persistent().set(&DataKey::TokenConfig(token), &config);
    }

    /// Create a new HTLC with any supported token
    pub fn create_htlc(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        amount: i128,
        hashlock: BytesN<32>,
        timelock: u64,
    ) -> u64 {
        // Check if paused
        let paused: bool = env.storage().persistent().get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "Contract is paused");

        // Verify token is supported and enabled
        let config: TokenConfig = env.storage().persistent()
            .get(&DataKey::TokenConfig(token.clone()))
            .expect("Token not supported");
        
        assert!(config.enabled, "Token is disabled");
        assert!(amount >= config.min_amount, "Amount below minimum");
        assert!(amount <= config.max_amount, "Amount above maximum");

        // Require sender auth
        sender.require_auth();
        
        // Validate inputs
        assert!(amount > 0, "Amount must be positive");
        assert!(timelock > env.ledger().timestamp(), "Timelock must be in the future");
        
        // Transfer tokens to contract
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);
        
        // Get and increment counter
        let mut counter: u64 = env.storage().persistent().get(&DataKey::HTLCCounter).unwrap_or(0);
        counter += 1;
        env.storage().persistent().set(&DataKey::HTLCCounter, &counter);
        
        // Create HTLC
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
            (symbol_short!("htlc_new"), counter),
            (sender, receiver, token, amount, hashlock, timelock)
        );
        
        log!(&env, "HTLC {} created with token {:?}", counter, config.symbol);
        
        counter
    }
    
    /// Withdraw funds by revealing the secret
    pub fn withdraw(env: Env, htlc_id: u64, secret: BytesN<32>) {
        // Get HTLC
        let mut htlc: HTLCState = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Check conditions
        assert!(!htlc.withdrawn, "Already withdrawn");
        assert!(!htlc.refunded, "Already refunded");
        assert!(env.ledger().timestamp() < htlc.timelock, "Timelock expired");
        
        // Verify secret using keccak256
        let secret_bytes = soroban_sdk::Bytes::from(secret.clone());
        let computed_hash = env.crypto().keccak256(&secret_bytes);
        let computed_hash_bytes: BytesN<32> = computed_hash.into();
        assert!(computed_hash_bytes == htlc.hashlock, "Invalid secret");
        
        // Require receiver auth
        htlc.receiver.require_auth();
        
        // Transfer tokens
        let token_client = TokenClient::new(&env, &htlc.token);
        token_client.transfer(
            &env.current_contract_address(),
            &htlc.receiver,
            &htlc.amount
        );
        
        // Update state
        htlc.withdrawn = true;
        htlc.secret = Some(secret.clone());
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        // Emit event
        env.events().publish(
            (symbol_short!("htlc_with"), htlc_id),
            (htlc.receiver, htlc.amount, secret)
        );
        
        log!(&env, "HTLC {} withdrawn", htlc_id);
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
        
        // Transfer tokens back
        let token_client = TokenClient::new(&env, &htlc.token);
        token_client.transfer(
            &env.current_contract_address(),
            &htlc.sender,
            &htlc.amount
        );
        
        // Update state
        htlc.refunded = true;
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        // Emit event
        env.events().publish(
            (symbol_short!("htlc_ref"), htlc_id),
            htlc.sender
        );
        
        log!(&env, "HTLC {} refunded", htlc_id);
    }
    
    /// Get HTLC details
    pub fn get_htlc(env: Env, htlc_id: u64) -> HTLCState {
        env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found")
    }
    
    /// Get supported tokens
    pub fn get_supported_tokens(env: Env) -> Vec<Address> {
        env.storage().persistent()
            .get(&DataKey::SupportedTokens)
            .unwrap_or(Vec::new(&env))
    }
    
    /// Get token configuration
    pub fn get_token_config(env: Env, token: Address) -> Option<TokenConfig> {
        env.storage().persistent()
            .get(&DataKey::TokenConfig(token))
    }
    
    /// Pause/unpause contract
    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        env.storage().persistent().set(&DataKey::Paused, &paused);
        log!(&env, "Contract paused: {}", paused);
    }
}