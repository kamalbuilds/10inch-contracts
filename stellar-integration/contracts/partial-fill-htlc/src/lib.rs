#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, log, symbol_short, vec, Address, BytesN, Env, Map, Symbol, Vec
};
use soroban_token_sdk::TokenClient;

#[contracttype]
#[derive(Clone, Debug)]
pub struct PartialHTLC {
    pub id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub filled_amount: i128,
    pub min_fill_amount: i128,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub allow_partial_withdraw: bool,
    pub completed: bool,
    pub refunded: bool,
    pub fills: Vec<Fill>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Fill {
    pub filler: Address,
    pub amount: i128,
    pub timestamp: u64,
    pub secret: Option<BytesN<32>>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    HTLCCounter,
    HTLC(u64),
    FillNonce(u64),
    ResolverDeposits(Address),
    MinDeposit,
    DepositMultiplier,
}

#[contract]
pub struct PartialFillHTLC;

#[contractimpl]
impl PartialFillHTLC {
    /// Initialize the contract
    pub fn initialize(env: Env, admin: Address, min_deposit: i128, deposit_multiplier: u32) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::HTLCCounter, &0u64);
        env.storage().persistent().set(&DataKey::MinDeposit, &min_deposit);
        env.storage().persistent().set(&DataKey::DepositMultiplier, &deposit_multiplier);
    }

    /// Create a new partial-fill HTLC
    pub fn create_partial_htlc(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        min_fill_amount: i128,
        hashlock: BytesN<32>,
        timelock: u64,
        allow_partial_withdraw: bool,
    ) -> u64 {
        sender.require_auth();
        
        // Validate inputs
        assert!(total_amount > 0, "Amount must be positive");
        assert!(min_fill_amount > 0 && min_fill_amount <= total_amount, "Invalid min fill");
        assert!(timelock > env.ledger().timestamp(), "Timelock must be in the future");
        
        // Transfer tokens to contract
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &total_amount);
        
        // Get and increment counter
        let mut counter: u64 = env.storage().persistent().get(&DataKey::HTLCCounter).unwrap_or(0);
        counter += 1;
        env.storage().persistent().set(&DataKey::HTLCCounter, &counter);
        
        // Create HTLC
        let htlc = PartialHTLC {
            id: counter,
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            filled_amount: 0,
            min_fill_amount,
            hashlock: hashlock.clone(),
            timelock,
            allow_partial_withdraw,
            completed: false,
            refunded: false,
            fills: Vec::new(&env),
        };
        
        // Store HTLC
        env.storage().persistent().set(&DataKey::HTLC(counter), &htlc);
        
        // Emit event
        env.events().publish(
            (symbol_short!("phtlc_new"), counter),
            (sender, receiver, token, total_amount, min_fill_amount)
        );
        
        log!(&env, "Partial HTLC {} created, total: {}, min fill: {}", 
             counter, total_amount, min_fill_amount);
        
        counter
    }

    /// Fill part of an HTLC (for resolvers)
    pub fn fill_htlc(
        env: Env,
        htlc_id: u64,
        filler: Address,
        amount: i128,
        secret: BytesN<32>,
    ) {
        filler.require_auth();
        
        // Get HTLC
        let mut htlc: PartialHTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Check conditions
        assert!(!htlc.completed && !htlc.refunded, "HTLC already closed");
        assert!(env.ledger().timestamp() < htlc.timelock, "Timelock expired");
        assert!(amount >= htlc.min_fill_amount, "Amount below minimum fill");
        assert!(htlc.filled_amount + amount <= htlc.total_amount, "Exceeds total amount");
        
        // Verify secret
        let secret_bytes = soroban_sdk::Bytes::from(secret.clone());
        let computed_hash = env.crypto().keccak256(&secret_bytes);
        let computed_hash_bytes: BytesN<32> = computed_hash.into();
        assert!(computed_hash_bytes == htlc.hashlock, "Invalid secret");
        
        // Check resolver deposit
        let required_deposit = (amount * htlc.total_amount) / htlc.total_amount;
        let deposit_key = DataKey::ResolverDeposits(filler.clone());
        let current_deposit: i128 = env.storage().persistent()
            .get(&deposit_key)
            .unwrap_or(0);
        assert!(current_deposit >= required_deposit, "Insufficient deposit");
        
        // Transfer tokens to filler (they will handle the cross-chain part)
        let token_client = TokenClient::new(&env, &htlc.token);
        token_client.transfer(
            &env.current_contract_address(),
            &filler,
            &amount
        );
        
        // Record fill
        let fill = Fill {
            filler: filler.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
            secret: Some(secret.clone()),
        };
        htlc.fills.push_back(fill);
        htlc.filled_amount += amount;
        
        // Check if fully filled
        if htlc.filled_amount == htlc.total_amount {
            htlc.completed = true;
            log!(&env, "HTLC {} fully filled", htlc_id);
        }
        
        // Store updated HTLC
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        // Emit event
        env.events().publish(
            (symbol_short!("phtlc_fill"), htlc_id),
            (filler, amount, htlc.filled_amount, htlc.total_amount)
        );
    }

    /// Withdraw filled amount (for receiver)
    pub fn withdraw_filled(env: Env, htlc_id: u64, secret: BytesN<32>) {
        // Get HTLC
        let htlc: PartialHTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Verify receiver
        htlc.receiver.require_auth();
        
        // Verify secret
        let secret_bytes = soroban_sdk::Bytes::from(secret.clone());
        let computed_hash = env.crypto().keccak256(&secret_bytes);
        let computed_hash_bytes: BytesN<32> = computed_hash.into();
        assert!(computed_hash_bytes == htlc.hashlock, "Invalid secret");
        
        // Check if partial withdraw is allowed or fully filled
        assert!(
            htlc.allow_partial_withdraw || htlc.completed,
            "Partial withdraw not allowed"
        );
        
        // This is a simplified version - in production, we'd track
        // which fills have been withdrawn
        log!(&env, "Withdraw from HTLC {} recorded", htlc_id);
        
        // Emit event
        env.events().publish(
            (symbol_short!("phtlc_wdrw"), htlc_id),
            (htlc.receiver, htlc.filled_amount, secret)
        );
    }

    /// Refund unfilled amount after timelock
    pub fn refund_unfilled(env: Env, htlc_id: u64) {
        // Get HTLC
        let mut htlc: PartialHTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Check conditions
        assert!(!htlc.refunded, "Already refunded");
        assert!(env.ledger().timestamp() >= htlc.timelock, "Timelock not expired");
        
        // Require sender auth
        htlc.sender.require_auth();
        
        // Calculate refund amount
        let refund_amount = htlc.total_amount - htlc.filled_amount;
        
        if refund_amount > 0 {
            // Transfer unfilled amount back
            let token_client = TokenClient::new(&env, &htlc.token);
            token_client.transfer(
                &env.current_contract_address(),
                &htlc.sender,
                &refund_amount
            );
        }
        
        // Mark as refunded
        htlc.refunded = true;
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        // Emit event
        env.events().publish(
            (symbol_short!("phtlc_ref"), htlc_id),
            (htlc.sender, refund_amount)
        );
        
        log!(&env, "HTLC {} refunded, amount: {}", htlc_id, refund_amount);
    }

    /// Deposit safety collateral (for resolvers)
    pub fn deposit_collateral(env: Env, resolver: Address, token: Address, amount: i128) {
        resolver.require_auth();
        
        // Transfer tokens to contract
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&resolver, &env.current_contract_address(), &amount);
        
        // Update deposit balance
        let deposit_key = DataKey::ResolverDeposits(resolver.clone());
        let current: i128 = env.storage().persistent()
            .get(&deposit_key)
            .unwrap_or(0);
        
        env.storage().persistent().set(&deposit_key, &(current + amount));
        
        log!(&env, "Resolver {} deposited {}", resolver, amount);
    }

    /// Withdraw collateral (for resolvers)
    pub fn withdraw_collateral(env: Env, resolver: Address, token: Address, amount: i128) {
        resolver.require_auth();
        
        // Check balance
        let deposit_key = DataKey::ResolverDeposits(resolver.clone());
        let current: i128 = env.storage().persistent()
            .get(&deposit_key)
            .expect("No deposit found");
        
        assert!(current >= amount, "Insufficient deposit");
        
        // Transfer tokens back
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &resolver, &amount);
        
        // Update balance
        env.storage().persistent().set(&deposit_key, &(current - amount));
        
        log!(&env, "Resolver {} withdrew {}", resolver, amount);
    }

    /// Get HTLC details
    pub fn get_htlc(env: Env, htlc_id: u64) -> PartialHTLC {
        env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found")
    }

    /// Get resolver deposit
    pub fn get_deposit(env: Env, resolver: Address) -> i128 {
        env.storage().persistent()
            .get(&DataKey::ResolverDeposits(resolver))
            .unwrap_or(0)
    }
}