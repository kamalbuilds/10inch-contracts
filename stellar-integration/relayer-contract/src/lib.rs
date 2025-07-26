#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, Symbol, log, String, Vec, vec
};

/// Relayer order structure
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelayerOrder {
    pub id: u64,
    pub initiator: Address,
    pub receiver: String, // External chain address
    pub token: Address,
    pub amount: i128,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub dest_chain: u32,
    pub dest_token: String,
    pub relayer_fee: i128,
    pub safety_deposit: i128,
    pub status: OrderStatus,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderStatus {
    Active = 0,
    Completed = 1,
    Cancelled = 2,
    Expired = 3,
}

#[contracttype]
pub enum DataKey {
    OrderCounter,
    Order(u64),
    RelayerAuth(Address),
    Admin,
    HTLCContract,
    MinSafetyDeposit,
    RelayerFeeRate,
}

#[contract]
pub struct FusionRelayer;

#[contractimpl]
impl FusionRelayer {
    /// Initialize the relayer contract
    pub fn initialize(env: Env, admin: Address, htlc_contract: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::HTLCContract, &htlc_contract);
        env.storage().instance().set(&DataKey::OrderCounter, &0u64);
        env.storage().instance().set(&DataKey::MinSafetyDeposit, &1000000i128); // 0.1 XLM
        env.storage().instance().set(&DataKey::RelayerFeeRate, &50u32); // 0.5%
        log!(&env, "FusionRelayer initialized");
    }

    /// Create a new cross-chain order
    pub fn create_order(
        env: Env,
        initiator: Address,
        receiver: String,
        token: Address,
        amount: i128,
        hashlock: BytesN<32>,
        timelock: u64,
        dest_chain: u32,
        dest_token: String,
        safety_deposit: i128,
    ) -> u64 {
        initiator.require_auth();
        
        // Validate inputs
        assert!(amount > 0, "Amount must be positive");
        assert!(timelock > env.ledger().timestamp() + 3600, "Timelock must be at least 1 hour");
        
        let min_deposit: i128 = env.storage().instance().get(&DataKey::MinSafetyDeposit).unwrap();
        assert!(safety_deposit >= min_deposit, "Safety deposit too low");
        
        // Calculate relayer fee
        let fee_rate: u32 = env.storage().instance().get(&DataKey::RelayerFeeRate).unwrap();
        let relayer_fee = (amount * fee_rate as i128) / 10000;
        
        // Get and increment counter
        let mut counter: u64 = env.storage().instance().get(&DataKey::OrderCounter).unwrap_or(0);
        counter += 1;
        env.storage().instance().set(&DataKey::OrderCounter, &counter);
        
        // Transfer safety deposit to contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&initiator, &env.current_contract_address(), &safety_deposit);
        
        // Create order
        let order = RelayerOrder {
            id: counter,
            initiator: initiator.clone(),
            receiver: receiver.clone(),
            token: token.clone(),
            amount,
            hashlock: hashlock.clone(),
            timelock,
            dest_chain,
            dest_token: dest_token.clone(),
            relayer_fee,
            safety_deposit,
            status: OrderStatus::Active,
            created_at: env.ledger().timestamp(),
        };
        
        // Store order
        env.storage().persistent().set(&DataKey::Order(counter), &order);
        
        // Emit event
        env.events().publish(
            (Symbol::new(&env, "order_created"), counter),
            (initiator, amount, dest_chain, hashlock, timelock)
        );
        
        log!(&env, "Order {} created: {} XLM -> chain {}", counter, amount, dest_chain);
        
        counter
    }

    /// Authorize a relayer
    pub fn authorize_relayer(env: Env, relayer: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("Not initialized");
        admin.require_auth();
        
        env.storage().persistent().set(&DataKey::RelayerAuth(relayer.clone()), &true);
        log!(&env, "Relayer {} authorized", relayer);
    }

    /// Complete order after relayer reveals secret
    pub fn complete_order(
        env: Env,
        order_id: u64,
        secret: BytesN<32>,
    ) {
        // Get order
        let mut order: RelayerOrder = env.storage().persistent()
            .get(&DataKey::Order(order_id))
            .expect("Order not found");
        
        // Verify secret
        let secret_bytes = soroban_sdk::Bytes::from(secret.clone());
        let computed_hash = env.crypto().keccak256(&secret_bytes);
        let computed_hash_bytes: BytesN<32> = computed_hash.into();
        assert!(computed_hash_bytes == order.hashlock, "Invalid secret");
        
        // Update status
        order.status = OrderStatus::Completed;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        
        // Return safety deposit to initiator
        if order.safety_deposit > 0 {
            let token_client = token::Client::new(&env, &order.token);
            token_client.transfer(
                &env.current_contract_address(),
                &order.initiator,
                &order.safety_deposit
            );
        }
        
        // Emit event
        env.events().publish(
            (Symbol::new(&env, "order_completed"), order_id),
            (order.initiator, secret)
        );
        
        log!(&env, "Order {} completed with secret", order_id);
    }

    /// Cancel expired order
    pub fn cancel_order(env: Env, order_id: u64) {
        // Get order
        let mut order: RelayerOrder = env.storage().persistent()
            .get(&DataKey::Order(order_id))
            .expect("Order not found");
        
        // Check if expired
        assert!(env.ledger().timestamp() >= order.timelock, "Order not expired");
        assert!(order.status != OrderStatus::Cancelled, "Already cancelled");
        
        order.initiator.require_auth();
        
        // Return safety deposit
        if order.safety_deposit > 0 {
            let token_client = token::Client::new(&env, &order.token);
            token_client.transfer(
                &env.current_contract_address(),
                &order.initiator,
                &order.safety_deposit
            );
        }
        
        // Update status
        order.status = OrderStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Order(order_id), &order);
        
        // Emit event
        env.events().publish(
            (Symbol::new(&env, "order_cancelled"), order_id),
            order.initiator
        );
        
        log!(&env, "Order {} cancelled", order_id);
    }

    /// Get order details
    pub fn get_order(env: Env, order_id: u64) -> Option<RelayerOrder> {
        env.storage().persistent().get(&DataKey::Order(order_id))
    }

    /// Check if relayer is authorized
    pub fn is_relayer_authorized(env: Env, relayer: Address) -> bool {
        env.storage().persistent()
            .get(&DataKey::RelayerAuth(relayer))
            .unwrap_or(false)
    }

    /// Get order count
    pub fn get_order_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::OrderCounter).unwrap_or(0)
    }
}