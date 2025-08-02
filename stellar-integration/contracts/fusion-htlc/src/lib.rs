#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, log, symbol_short, token, Address, BytesN, Env, Vec
};

#[contracttype]
#[derive(Clone, Debug)]
pub struct FusionHTLC {
    pub id: u64,
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub amount: i128,
    pub hashlock: BytesN<32>,
    pub secret: Option<BytesN<32>>,
    pub status: HTLCStatus,
    
    // Multi-stage timelocks
    pub finality_time: u64,           // When HTLC becomes final
    pub taker_deadline: u64,          // Exclusive period for original taker
    pub public_deadline: u64,         // Anyone can settle after this
    pub cancellation_start: u64,      // Private cancellation period starts
    pub cancellation_public: u64,     // Public cancellation period starts
    
    // Fusion-specific fields
    pub allowed_resolvers: Vec<Address>,  // Whitelisted resolvers for private period
    pub taker_address: Address,           // Original taker who can settle first
    pub resolver_fee_bps: u32,            // Resolver fee in basis points
    pub withdrawn_by: Option<Address>,    // Who withdrew the HTLC
    pub cancelled_by: Option<Address>,    // Who cancelled the HTLC
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HTLCStatus {
    Pending,              // Initial state
    Finalized,           // After finality_time, ready for settlement
    TakerSettlement,     // During taker exclusive period
    PrivateSettlement,   // Whitelisted resolvers can settle
    PublicSettlement,    // Anyone can settle
    PrivateCancellation, // Sender or whitelisted can cancel
    PublicCancellation,  // Anyone can cancel
    Completed,           // Successfully withdrawn
    Cancelled,           // Cancelled and refunded
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ResolverConfig {
    pub address: Address,
    pub priority: u32,        // Higher priority resolvers get earlier access
    pub fee_discount_bps: u32, // Fee discount for this resolver
    pub enabled: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    HTLCCounter,
    HTLC(u64),
    ResolverConfig(Address),
    GlobalResolvers,
    DefaultResolverFee,
    MinTimelock,
    MaxTimelock,
    Paused,
}

#[contract]
pub struct FusionHTLCContract;

#[contractimpl]
impl FusionHTLCContract {
    /// Initialize the contract
    pub fn initialize(
        env: Env, 
        admin: Address,
        default_resolver_fee_bps: u32,
        min_timelock: u64,
        max_timelock: u64,
    ) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::HTLCCounter, &0u64);
        env.storage().persistent().set(&DataKey::DefaultResolverFee, &default_resolver_fee_bps);
        env.storage().persistent().set(&DataKey::MinTimelock, &min_timelock);
        env.storage().persistent().set(&DataKey::MaxTimelock, &max_timelock);
        env.storage().persistent().set(&DataKey::GlobalResolvers, &Vec::<Address>::new(&env));
        env.storage().persistent().set(&DataKey::Paused, &false);
        
        log!(&env, "FusionHTLC initialized with admin: {}", admin);
    }

    /// Create a new Fusion HTLC with multi-stage timelocks
    pub fn create_fusion_htlc(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        amount: i128,
        hashlock: BytesN<32>,
        taker_address: Address,
        allowed_resolvers: Vec<Address>,
        stage_durations: StageDurations,
        resolver_fee_bps: Option<u32>,
    ) -> u64 {
        sender.require_auth();
        
        // Check if paused
        let paused: bool = env.storage().persistent().get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "Contract is paused");
        
        // Validate inputs
        assert!(amount > 0, "Amount must be positive");
        
        let current_time = env.ledger().timestamp();
        let min_timelock: u64 = env.storage().persistent().get(&DataKey::MinTimelock).unwrap();
        let max_timelock: u64 = env.storage().persistent().get(&DataKey::MaxTimelock).unwrap();
        
        // Calculate stage timestamps
        let finality_time = current_time + stage_durations.finality_delay;
        let taker_deadline = finality_time + stage_durations.taker_exclusive_duration;
        let public_deadline = taker_deadline + stage_durations.private_resolver_duration;
        let cancellation_start = public_deadline + stage_durations.public_resolver_duration;
        let cancellation_public = cancellation_start + stage_durations.private_cancellation_duration;
        
        // Validate total timelock duration
        let total_duration = cancellation_public - current_time;
        assert!(total_duration >= min_timelock, "Total duration too short");
        assert!(total_duration <= max_timelock, "Total duration too long");
        
        // Transfer tokens to contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);
        
        // Get and increment counter
        let mut counter: u64 = env.storage().persistent().get(&DataKey::HTLCCounter).unwrap_or(0);
        counter += 1;
        env.storage().persistent().set(&DataKey::HTLCCounter, &counter);
        
        // Get resolver fee
        let fee_bps = resolver_fee_bps.unwrap_or_else(|| {
            env.storage().persistent().get(&DataKey::DefaultResolverFee).unwrap()
        });
        
        // Create HTLC
        let htlc = FusionHTLC {
            id: counter,
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token.clone(),
            amount,
            hashlock: hashlock.clone(),
            secret: None,
            status: HTLCStatus::Pending,
            finality_time,
            taker_deadline,
            public_deadline,
            cancellation_start,
            cancellation_public,
            allowed_resolvers: allowed_resolvers.clone(),
            taker_address: taker_address.clone(),
            resolver_fee_bps: fee_bps,
            withdrawn_by: None,
            cancelled_by: None,
        };
        
        // Store HTLC
        env.storage().persistent().set(&DataKey::HTLC(counter), &htlc);
        
        // Emit event
        env.events().publish(
            (symbol_short!("fusion"), counter),
            (sender, receiver, token, amount, hashlock)
        );
        
        log!(&env, "Fusion HTLC {} created with multi-stage timelocks", counter);
        
        counter
    }
    
    /// Update HTLC status based on current time
    fn update_htlc_status(env: &Env, htlc: &mut FusionHTLC) {
        let current_time = env.ledger().timestamp();
        
        if htlc.status == HTLCStatus::Completed || htlc.status == HTLCStatus::Cancelled {
            return; // Terminal states
        }
        
        if current_time < htlc.finality_time {
            htlc.status = HTLCStatus::Pending;
        } else if current_time < htlc.taker_deadline {
            htlc.status = HTLCStatus::TakerSettlement;
        } else if current_time < htlc.public_deadline {
            htlc.status = HTLCStatus::PrivateSettlement;
        } else if current_time < htlc.cancellation_start {
            htlc.status = HTLCStatus::PublicSettlement;
        } else if current_time < htlc.cancellation_public {
            htlc.status = HTLCStatus::PrivateCancellation;
        } else {
            htlc.status = HTLCStatus::PublicCancellation;
        }
    }
    
    /// Withdraw funds by revealing the secret
    pub fn withdraw(env: Env, htlc_id: u64, withdrawer: Address, secret: BytesN<32>) {
        withdrawer.require_auth();
        
        // Get HTLC
        let mut htlc: FusionHTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Update status
        Self::update_htlc_status(&env, &mut htlc);
        
        // Check if already completed or cancelled
        assert!(htlc.status != HTLCStatus::Completed, "Already withdrawn");
        assert!(htlc.status != HTLCStatus::Cancelled, "Already cancelled");
        
        // Verify secret
        let secret_bytes = soroban_sdk::Bytes::from(secret.clone());
        let computed_hash = env.crypto().keccak256(&secret_bytes);
        let computed_hash_bytes: BytesN<32> = computed_hash.into();
        assert!(computed_hash_bytes == htlc.hashlock, "Invalid secret");
        
        // Check withdrawal permissions based on current stage
        let can_withdraw = match htlc.status {
            HTLCStatus::Pending => false,
            HTLCStatus::TakerSettlement => withdrawer == htlc.taker_address,
            HTLCStatus::PrivateSettlement => {
                withdrawer == htlc.taker_address || 
                htlc.allowed_resolvers.contains(&withdrawer) ||
                Self::is_global_resolver(&env, &withdrawer)
            },
            HTLCStatus::PublicSettlement => true,
            HTLCStatus::PrivateCancellation | HTLCStatus::PublicCancellation => false,
            _ => false,
        };
        
        assert!(can_withdraw, "Not authorized to withdraw at this stage");
        
        // Calculate amounts
        let resolver_fee = if withdrawer != htlc.receiver {
            (htlc.amount * htlc.resolver_fee_bps as i128) / 10000
        } else {
            0
        };
        
        let receiver_amount = htlc.amount - resolver_fee;
        
        // Transfer tokens
        let token_client = token::Client::new(&env, &htlc.token);
        
        // Transfer to receiver
        token_client.transfer(
            &env.current_contract_address(),
            &htlc.receiver,
            &receiver_amount
        );
        
        // Transfer resolver fee if applicable
        if resolver_fee > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &withdrawer,
                &resolver_fee
            );
        }
        
        // Update state
        htlc.status = HTLCStatus::Completed;
        htlc.secret = Some(secret.clone());
        htlc.withdrawn_by = Some(withdrawer.clone());
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        // Emit event
        env.events().publish(
            (symbol_short!("withdrawn"), htlc_id),
            (withdrawer.clone(), htlc.receiver, receiver_amount, resolver_fee)
        );
        
        log!(&env, "HTLC {} withdrawn by {}", htlc_id, withdrawer);
    }
    
    /// Cancel HTLC and refund
    pub fn cancel(env: Env, htlc_id: u64, canceller: Address) {
        canceller.require_auth();
        
        // Get HTLC
        let mut htlc: FusionHTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Update status
        Self::update_htlc_status(&env, &mut htlc);
        
        // Check if already completed or cancelled
        assert!(htlc.status != HTLCStatus::Completed, "Already withdrawn");
        assert!(htlc.status != HTLCStatus::Cancelled, "Already cancelled");
        
        // Check cancellation permissions based on current stage
        let can_cancel = match htlc.status {
            HTLCStatus::PrivateCancellation => {
                canceller == htlc.sender || 
                htlc.allowed_resolvers.contains(&canceller) ||
                Self::is_global_resolver(&env, &canceller)
            },
            HTLCStatus::PublicCancellation => true,
            _ => false,
        };
        
        assert!(can_cancel, "Not authorized to cancel at this stage");
        
        // Transfer tokens back to sender
        let token_client = token::Client::new(&env, &htlc.token);
        token_client.transfer(
            &env.current_contract_address(),
            &htlc.sender,
            &htlc.amount
        );
        
        // Update state
        htlc.status = HTLCStatus::Cancelled;
        htlc.cancelled_by = Some(canceller.clone());
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        // Emit event
        env.events().publish(
            (symbol_short!("cancelled"), htlc_id),
            (canceller.clone(), htlc.sender, htlc.amount)
        );
        
        log!(&env, "HTLC {} cancelled by {}", htlc_id, canceller);
    }
    
    /// Add a global resolver
    pub fn add_global_resolver(env: Env, resolver: Address, priority: u32, fee_discount_bps: u32) {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        let config = ResolverConfig {
            address: resolver.clone(),
            priority,
            fee_discount_bps,
            enabled: true,
        };
        
        env.storage().persistent().set(&DataKey::ResolverConfig(resolver.clone()), &config);
        
        // Add to global resolvers list
        let mut resolvers: Vec<Address> = env.storage().persistent()
            .get(&DataKey::GlobalResolvers)
            .unwrap_or(Vec::new(&env));
        
        if !resolvers.contains(&resolver) {
            resolvers.push_back(resolver.clone());
            env.storage().persistent().set(&DataKey::GlobalResolvers, &resolvers);
        }
        
        log!(&env, "Global resolver added: {}", resolver);
    }
    
    /// Check if an address is a global resolver
    fn is_global_resolver(env: &Env, address: &Address) -> bool {
        if let Some(config) = env.storage().persistent()
            .get::<DataKey, ResolverConfig>(&DataKey::ResolverConfig(address.clone())) {
            config.enabled
        } else {
            false
        }
    }
    
    /// Get HTLC details
    pub fn get_htlc(env: Env, htlc_id: u64) -> FusionHTLC {
        let mut htlc: FusionHTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        // Update status before returning
        Self::update_htlc_status(&env, &mut htlc);
        env.storage().persistent().set(&DataKey::HTLC(htlc_id), &htlc);
        
        htlc
    }
    
    /// Get current stage of HTLC
    pub fn get_htlc_stage(env: Env, htlc_id: u64) -> HTLCStatus {
        let mut htlc: FusionHTLC = env.storage().persistent()
            .get(&DataKey::HTLC(htlc_id))
            .expect("HTLC not found");
        
        Self::update_htlc_status(&env, &mut htlc);
        htlc.status
    }
    
    /// Pause/unpause contract
    pub fn set_paused(env: Env, paused: bool) {
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        env.storage().persistent().set(&DataKey::Paused, &paused);
        log!(&env, "Contract paused: {}", paused);
    }
}

/// Stage durations for multi-stage HTLC
#[contracttype]
#[derive(Clone, Debug)]
pub struct StageDurations {
    pub finality_delay: u64,                    // Time until HTLC is finalized
    pub taker_exclusive_duration: u64,          // Taker-only period
    pub private_resolver_duration: u64,         // Whitelisted resolvers period
    pub public_resolver_duration: u64,          // Anyone can resolve period
    pub private_cancellation_duration: u64,     // Private cancellation period
}