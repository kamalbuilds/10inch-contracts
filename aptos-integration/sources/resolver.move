/// 1inch Fusion+ Resolver Module for Aptos
/// Handles cross-chain atomic swap resolution and relaying
module fusion_swap::resolver {
    use std::signer;
    use std::vector;
    use std::bcs;
    use std::aptos_hash;
    use aptos_framework::account::{Self, SignerCapability};
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::timestamp;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::table::{Self, Table};
    
    use fusion_swap::atomic_swap;

    //===================================================================================
    // Error Codes
    //===================================================================================
    
    const E_NOT_INITIALIZED: u64 = 100;
    const E_ALREADY_INITIALIZED: u64 = 101;
    const E_NOT_OWNER: u64 = 102;
    const E_NOT_RESOLVER: u64 = 103;
    const E_ORDER_NOT_FOUND: u64 = 104;
    const E_ORDER_ALREADY_DEPLOYED: u64 = 105;
    const E_INVALID_SECRET: u64 = 106;
    const E_ORDER_EXPIRED: u64 = 107;
    const E_ORDER_NOT_EXPIRED: u64 = 108;
    const E_ORDER_COMPLETED: u64 = 109;
    const E_ORDER_CANCELLED: u64 = 110;
    const E_INSUFFICIENT_SAFETY_DEPOSIT: u64 = 111;

    //===================================================================================
    // Constants
    //===================================================================================
    
    const MIN_SAFETY_DEPOSIT: u64 = 1000000; // 0.01 APT minimum
    const RESOLVER_FEE_BPS: u64 = 25; // 0.25% resolver fee

    //===================================================================================
    // Structs
    //===================================================================================
    
    struct ResolverOrder has copy, drop, store {
        order_id: u64,
        initiator: address,
        resolver: address,
        src_chain_id: u64,
        dst_chain_id: u64,
        src_amount: u64,
        dst_amount: u64,
        safety_deposit: u64,
        secret_hash: vector<u8>,
        src_timelock: u64,
        dst_timelock: u64,
        src_deployed: bool,
        dst_deployed: bool,
        completed: bool,
        cancelled: bool,
        created_at: u64,
        completed_at: u64,
    }

    struct ResolverEscrow<phantom CoinType> has key {
        order_id: u64,
        coins: Coin<CoinType>,
        safety_deposit: Coin<CoinType>,
        signer_cap: SignerCapability,
    }

    struct ResolverState<phantom CoinType> has key {
        orders: Table<u64, ResolverOrder>,
        secret_hash_to_order: Table<vector<u8>, u64>,
        next_order_id: u64,
        owner: address,
        total_volume: u64,
        total_fees_collected: u64,
        signer_cap: SignerCapability,
        // Events
        src_deployed_events: EventHandle<SrcDeployedEvent>,
        dst_deployed_events: EventHandle<DstDeployedEvent>,
        withdrawn_events: EventHandle<WithdrawnEvent>,
        cancelled_events: EventHandle<CancelledEvent>,
    }

    //===================================================================================
    // Events
    //===================================================================================
    
    struct SrcDeployedEvent has drop, store {
        order_id: u64,
        resolver: address,
        amount: u64,
        safety_deposit: u64,
        secret_hash: vector<u8>,
    }

    struct DstDeployedEvent has drop, store {
        order_id: u64,
        dst_chain_id: u64,
        dst_amount: u64,
    }

    struct WithdrawnEvent has drop, store {
        order_id: u64,
        withdrawer: address,
        amount: u64,
        is_source: bool,
    }

    struct CancelledEvent has drop, store {
        order_id: u64,
        canceller: address,
        amount_refunded: u64,
    }

    //===================================================================================
    // Initialize Function
    //===================================================================================
    
    public entry fun initialize<CoinType>(owner: &signer) {
        let owner_addr = signer::address_of(owner);
        assert!(!exists<ResolverState<CoinType>>(owner_addr), E_ALREADY_INITIALIZED);
        
        // Create resource account
        let seed = b"fusion_resolver_v1";
        vector::append(&mut seed, bcs::to_bytes(&type_info::type_of<CoinType>()));
        let (resource_signer, signer_cap) = account::create_resource_account(owner, seed);
        
        move_to(owner, ResolverState<CoinType> {
            orders: table::new(),
            secret_hash_to_order: table::new(),
            next_order_id: 1,
            owner: owner_addr,
            total_volume: 0,
            total_fees_collected: 0,
            signer_cap,
            src_deployed_events: account::new_event_handle<SrcDeployedEvent>(owner),
            dst_deployed_events: account::new_event_handle<DstDeployedEvent>(owner),
            withdrawn_events: account::new_event_handle<WithdrawnEvent>(owner),
            cancelled_events: account::new_event_handle<CancelledEvent>(owner),
        });
    }

    //===================================================================================
    // Core Functions
    //===================================================================================
    
    /// Deploy source escrow as resolver
    public entry fun deploy_src<CoinType>(
        resolver: &signer,
        initiator: address,
        dst_chain_id: u64,
        src_amount: u64,
        dst_amount: u64,
        secret_hash: vector<u8>,
        safety_deposit: u64,
        timelock: u64,
        admin_addr: address,
    ) acquires ResolverState {
        let resolver_addr = signer::address_of(resolver);
        assert!(exists<ResolverState<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let state = borrow_global_mut<ResolverState<CoinType>>(admin_addr);
        
        // Validate inputs
        assert!(safety_deposit >= MIN_SAFETY_DEPOSIT, E_INSUFFICIENT_SAFETY_DEPOSIT);
        assert!(vector::length(&secret_hash) == 32, atomic_swap::get_invalid_secret_hash_error());
        
        // Generate order ID
        let order_id = state.next_order_id;
        state.next_order_id = order_id + 1;
        
        // Create escrow account
        let escrow_seed = b"resolver_escrow_";
        vector::append(&mut escrow_seed, bcs::to_bytes(&order_id));
        let resource_signer = account::create_signer_with_capability(&state.signer_cap);
        let (escrow_signer, escrow_cap) = account::create_resource_account(&resource_signer, escrow_seed);
        
        // Register coin type
        coin::register<CoinType>(&escrow_signer);
        
        // Withdraw funds and safety deposit from resolver
        let coins = coin::withdraw<CoinType>(resolver, src_amount);
        let safety = coin::withdraw<CoinType>(resolver, safety_deposit);
        
        // Store in escrow
        move_to(&escrow_signer, ResolverEscrow<CoinType> {
            order_id,
            coins,
            safety_deposit: safety,
            signer_cap: escrow_cap,
        });
        
        // Create order
        let order = ResolverOrder {
            order_id,
            initiator,
            resolver: resolver_addr,
            src_chain_id: 1, // Aptos
            dst_chain_id,
            src_amount,
            dst_amount,
            safety_deposit,
            secret_hash,
            src_timelock: timelock,
            dst_timelock: timelock + 3600, // 1 hour extra for dst
            src_deployed: true,
            dst_deployed: false,
            completed: false,
            cancelled: false,
            created_at: timestamp::now_seconds(),
            completed_at: 0,
        };
        
        // Store order
        table::add(&mut state.orders, order_id, order);
        table::add(&mut state.secret_hash_to_order, copy secret_hash, order_id);
        
        // Update stats
        state.total_volume = state.total_volume + src_amount;
        
        // Emit event
        event::emit_event(&mut state.src_deployed_events, SrcDeployedEvent {
            order_id,
            resolver: resolver_addr,
            amount: src_amount,
            safety_deposit,
            secret_hash,
        });
    }
    
    /// Mark destination escrow as deployed
    public entry fun deploy_dst<CoinType>(
        resolver: &signer,
        order_id: u64,
        admin_addr: address,
    ) acquires ResolverState {
        let resolver_addr = signer::address_of(resolver);
        assert!(exists<ResolverState<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let state = borrow_global_mut<ResolverState<CoinType>>(admin_addr);
        assert!(table::contains(&state.orders, order_id), E_ORDER_NOT_FOUND);
        
        let order = table::borrow_mut(&mut state.orders, order_id);
        assert!(order.resolver == resolver_addr, E_NOT_RESOLVER);
        assert!(order.src_deployed, E_ORDER_NOT_FOUND);
        assert!(!order.dst_deployed, E_ORDER_ALREADY_DEPLOYED);
        assert!(!order.cancelled && !order.completed, E_ORDER_COMPLETED);
        
        order.dst_deployed = true;
        
        event::emit_event(&mut state.dst_deployed_events, DstDeployedEvent {
            order_id,
            dst_chain_id: order.dst_chain_id,
            dst_amount: order.dst_amount,
        });
    }
    
    /// Withdraw funds by revealing secret
    public entry fun withdraw<CoinType>(
        withdrawer: &signer,
        order_id: u64,
        secret: vector<u8>,
        is_source: bool,
        admin_addr: address,
    ) acquires ResolverState, ResolverEscrow {
        let withdrawer_addr = signer::address_of(withdrawer);
        assert!(exists<ResolverState<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let state = borrow_global_mut<ResolverState<CoinType>>(admin_addr);
        assert!(table::contains(&state.orders, order_id), E_ORDER_NOT_FOUND);
        
        let order = table::borrow_mut(&mut state.orders, order_id);
        assert!(!order.completed, E_ORDER_COMPLETED);
        assert!(!order.cancelled, E_ORDER_CANCELLED);
        
        // Verify secret
        let computed_hash = aptos_hash::keccak256(secret);
        assert!(computed_hash == order.secret_hash, E_INVALID_SECRET);
        
        let escrow_addr = get_escrow_address(admin_addr, order_id);
        
        if (is_source) {
            // Resolver withdraws from source
            assert!(withdrawer_addr == order.resolver, E_NOT_RESOLVER);
            assert!(timestamp::now_seconds() <= order.src_timelock, E_ORDER_EXPIRED);
            
            let ResolverEscrow { order_id: _, coins, safety_deposit, signer_cap: _ } = 
                move_from<ResolverEscrow<CoinType>>(escrow_addr);
            
            // Calculate resolver fee
            let fee_amount = coin::value(&coins) * RESOLVER_FEE_BPS / 10000;
            let fee = coin::extract(&mut coins, fee_amount);
            
            // Transfer to resolver
            coin::deposit(withdrawer_addr, coins);
            coin::deposit(withdrawer_addr, safety_deposit);
            coin::deposit(withdrawer_addr, fee);
            
            state.total_fees_collected = state.total_fees_collected + fee_amount;
        } else {
            // User withdraws from destination (would be on different chain)
            assert!(withdrawer_addr == order.initiator, atomic_swap::get_not_initiator_error());
            order.completed = true;
            order.completed_at = timestamp::now_seconds();
        };
        
        event::emit_event(&mut state.withdrawn_events, WithdrawnEvent {
            order_id,
            withdrawer: withdrawer_addr,
            amount: order.src_amount,
            is_source,
        });
    }
    
    /// Cancel expired order
    public entry fun cancel<CoinType>(
        canceller: &signer,
        order_id: u64,
        admin_addr: address,
    ) acquires ResolverState, ResolverEscrow {
        let canceller_addr = signer::address_of(canceller);
        assert!(exists<ResolverState<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let state = borrow_global_mut<ResolverState<CoinType>>(admin_addr);
        assert!(table::contains(&state.orders, order_id), E_ORDER_NOT_FOUND);
        
        let order = table::borrow_mut(&mut state.orders, order_id);
        assert!(!order.completed, E_ORDER_COMPLETED);
        assert!(!order.cancelled, E_ORDER_CANCELLED);
        assert!(
            canceller_addr == order.initiator || canceller_addr == order.resolver,
            E_NOT_RESOLVER
        );
        assert!(timestamp::now_seconds() > order.src_timelock, E_ORDER_NOT_EXPIRED);
        
        order.cancelled = true;
        
        let escrow_addr = get_escrow_address(admin_addr, order_id);
        if (exists<ResolverEscrow<CoinType>>(escrow_addr)) {
            let ResolverEscrow { order_id: _, coins, safety_deposit, signer_cap: _ } = 
                move_from<ResolverEscrow<CoinType>>(escrow_addr);
            
            // Refund to initiator
            coin::deposit(order.initiator, coins);
            // Return safety deposit to resolver
            coin::deposit(order.resolver, safety_deposit);
        };
        
        event::emit_event(&mut state.cancelled_events, CancelledEvent {
            order_id,
            canceller: canceller_addr,
            amount_refunded: order.src_amount,
        });
    }

    //===================================================================================
    // View Functions
    //===================================================================================
    
    #[view]
    public fun get_order<CoinType>(admin_addr: address, order_id: u64): ResolverOrder acquires ResolverState {
        assert!(exists<ResolverState<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let state = borrow_global<ResolverState<CoinType>>(admin_addr);
        assert!(table::contains(&state.orders, order_id), E_ORDER_NOT_FOUND);
        *table::borrow(&state.orders, order_id)
    }
    
    #[view]
    public fun get_order_by_secret_hash<CoinType>(
        admin_addr: address, 
        secret_hash: vector<u8>
    ): u64 acquires ResolverState {
        assert!(exists<ResolverState<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let state = borrow_global<ResolverState<CoinType>>(admin_addr);
        assert!(table::contains(&state.secret_hash_to_order, secret_hash), E_ORDER_NOT_FOUND);
        *table::borrow(&state.secret_hash_to_order, secret_hash)
    }
    
    #[view]
    public fun can_withdraw<CoinType>(
        admin_addr: address,
        order_id: u64,
        user: address,
        is_source: bool
    ): bool acquires ResolverState {
        if (!exists<ResolverState<CoinType>>(admin_addr)) return false;
        let state = borrow_global<ResolverState<CoinType>>(admin_addr);
        if (!table::contains(&state.orders, order_id)) return false;
        
        let order = table::borrow(&state.orders, order_id);
        if (order.completed || order.cancelled) return false;
        
        if (is_source) {
            user == order.resolver && timestamp::now_seconds() <= order.src_timelock
        } else {
            user == order.initiator && order.dst_deployed
        }
    }
    
    #[view]
    public fun can_cancel<CoinType>(
        admin_addr: address,
        order_id: u64
    ): bool acquires ResolverState {
        if (!exists<ResolverState<CoinType>>(admin_addr)) return false;
        let state = borrow_global<ResolverState<CoinType>>(admin_addr);
        if (!table::contains(&state.orders, order_id)) return false;
        
        let order = table::borrow(&state.orders, order_id);
        !order.completed && !order.cancelled && timestamp::now_seconds() > order.src_timelock
    }
    
    #[view]
    public fun get_stats<CoinType>(admin_addr: address): (u64, u64, u64) acquires ResolverState {
        assert!(exists<ResolverState<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let state = borrow_global<ResolverState<CoinType>>(admin_addr);
        (state.next_order_id - 1, state.total_volume, state.total_fees_collected)
    }

    //===================================================================================
    // Helper Functions
    //===================================================================================
    
    fun get_escrow_address(admin_addr: address, order_id: u64): address {
        let escrow_seed = b"resolver_escrow_";
        vector::append(&mut escrow_seed, bcs::to_bytes(&order_id));
        account::create_resource_address(&admin_addr, escrow_seed)
    }
    
    use std::type_info;
}