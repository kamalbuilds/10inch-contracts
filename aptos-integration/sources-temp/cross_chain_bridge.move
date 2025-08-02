/// 1inch Fusion+ Cross-Chain Bridge Contract for Aptos
/// Coordinates cross-chain atomic swaps between Aptos and other blockchains
module fusion_swap::cross_chain_bridge {
    use std::signer;
    use std::vector;
    use std::string::{Self, String};
    use aptos_framework::account;
    use aptos_framework::coin;
    use aptos_framework::timestamp;
    use aptos_framework::table::{Self, Table};
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::type_info;
    use fusion_swap::atomic_swap;

    //===================================================================================
    // Error Codes  
    //===================================================================================

    const E_NOT_INITIALIZED: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_BRIDGE_ORDER_NOT_FOUND: u64 = 3;
    const E_BRIDGE_ORDER_COMPLETED: u64 = 4;
    const E_BRIDGE_ORDER_CANCELLED: u64 = 5;
    const E_INVALID_CHAIN_ID: u64 = 6;
    const E_INVALID_AMOUNT: u64 = 7;
    const E_INVALID_ADDRESS: u64 = 8;
    const E_NOT_AUTHORIZED: u64 = 9;
    const E_TIMELOCK_EXPIRED: u64 = 10;
    const E_INSUFFICIENT_FEE: u64 = 11;
    const E_UNSUPPORTED_TOKEN: u64 = 12;

    //===================================================================================
    // Constants
    //===================================================================================

    /// Chain IDs for supported blockchains
    const CHAIN_ID_ETHEREUM: u64 = 1;
    const CHAIN_ID_BITCOIN: u64 = 2;
    const CHAIN_ID_APTOS: u64 = 3;
    const CHAIN_ID_SUI: u64 = 4;
    const CHAIN_ID_POLYGON: u64 = 5;
    const CHAIN_ID_ARBITRUM: u64 = 6;
    const CHAIN_ID_OPTIMISM: u64 = 7;

    /// Default cross-chain timelock (4 hours)
    const DEFAULT_CROSS_CHAIN_TIMELOCK: u64 = 14400;

    /// Bridge fee in basis points (0.05% = 5 basis points)
    const BRIDGE_FEE_BPS: u64 = 5;

    //===================================================================================
    // Structs & Resources
    //===================================================================================

    /// Represents a cross-chain bridge order
    struct BridgeOrder has store, drop, copy {
        /// Unique order ID
        id: u64,
        /// Source chain ID
        source_chain_id: u64,
        /// Destination chain ID  
        destination_chain_id: u64,
        /// Order initiator on source chain
        initiator: address,
        /// Recipient address on destination chain (as bytes)
        recipient: vector<u8>,
        /// Source token amount
        source_amount: u64,
        /// Minimum destination amount expected
        min_destination_amount: u64,
        /// Secret hash for atomic swap
        secret_hash: vector<u8>,
        /// Expiry timestamp
        expiry_timestamp: u64,
        /// Local HTLC swap ID (if source chain is Aptos)
        local_swap_id: u64,
        /// Remote transaction hash/proof (if destination chain is Aptos)
        remote_tx_hash: vector<u8>,
        /// Order status: 0=Active, 1=Completed, 2=Cancelled, 3=Expired
        status: u8,
        /// Creation timestamp
        created_at: u64,
        /// Completion timestamp
        completed_at: u64,
    }

    /// Cross-chain bridge state for a specific coin type
    struct CrossChainBridge<phantom CoinType> has key {
        /// Bridge orders mapping
        orders: Table<u64, BridgeOrder>,
        /// Next order ID counter
        next_order_id: u64,
        /// Supported chain IDs
        supported_chains: vector<u64>,
        /// Fee collector address
        fee_collector: address,
        /// Minimum amounts per chain
        min_amounts: Table<u64, u64>,
        /// Event handles
        order_created_events: EventHandle<OrderCreatedEvent>,
        order_completed_events: EventHandle<OrderCompletedEvent>,
        order_cancelled_events: EventHandle<OrderCancelledEvent>,
    }

    /// Configuration for chain-specific settings
    struct ChainConfig has store, drop, copy {
        chain_id: u64,
        chain_name: String,
        min_amount: u64,
        max_amount: u64,
        default_timelock: u64,
        enabled: bool,
    }

    //===================================================================================
    // Events
    //===================================================================================

    struct OrderCreatedEvent has drop, store {
        order_id: u64,
        source_chain_id: u64,
        destination_chain_id: u64,
        initiator: address,
        recipient: vector<u8>,
        source_amount: u64,
        min_destination_amount: u64,
        secret_hash: vector<u8>,
        expiry_timestamp: u64,
    }

    struct OrderCompletedEvent has drop, store {
        order_id: u64,
        secret: vector<u8>,
        completion_timestamp: u64,
        local_swap_id: u64,
        remote_tx_hash: vector<u8>,
    }

    struct OrderCancelledEvent has drop, store {
        order_id: u64,
        cancellation_timestamp: u64,
        reason: String,
    }

    //===================================================================================
    // Core Functions
    //===================================================================================

    /// Initialize the cross-chain bridge for a specific coin type
    public entry fun initialize<CoinType>(
        admin: &signer,
        fee_collector: address,
    ) {
        let admin_addr = signer::address_of(admin);
        
        // Ensure not already initialized
        assert!(!exists<CrossChainBridge<CoinType>>(admin_addr), E_ALREADY_INITIALIZED);
        
        // Initialize supported chains
        let supported_chains = vector::empty<u64>();
        vector::push_back(&mut supported_chains, CHAIN_ID_ETHEREUM);
        vector::push_back(&mut supported_chains, CHAIN_ID_BITCOIN);
        vector::push_back(&mut supported_chains, CHAIN_ID_APTOS);
        vector::push_back(&mut supported_chains, CHAIN_ID_SUI);
        vector::push_back(&mut supported_chains, CHAIN_ID_POLYGON);
        vector::push_back(&mut supported_chains, CHAIN_ID_ARBITRUM);
        vector::push_back(&mut supported_chains, CHAIN_ID_OPTIMISM);
        
        // Initialize minimum amounts
        let min_amounts = table::new<u64, u64>();
        table::add(&mut min_amounts, CHAIN_ID_ETHEREUM, 1000000); // 0.01 token (assuming 8 decimals)
        table::add(&mut min_amounts, CHAIN_ID_BITCOIN, 100000);   // 0.001 BTC
        table::add(&mut min_amounts, CHAIN_ID_APTOS, 1000000);    // 0.01 APT
        table::add(&mut min_amounts, CHAIN_ID_SUI, 1000000);      // 0.01 SUI
        table::add(&mut min_amounts, CHAIN_ID_POLYGON, 1000000);  // 0.01 MATIC
        table::add(&mut min_amounts, CHAIN_ID_ARBITRUM, 1000000); // 0.01 ARB
        table::add(&mut min_amounts, CHAIN_ID_OPTIMISM, 1000000); // 0.01 OP
        
        // Initialize the bridge
        move_to(admin, CrossChainBridge<CoinType> {
            orders: table::new(),
            next_order_id: 1,
            supported_chains,
            fee_collector,
            min_amounts,
            order_created_events: account::new_event_handle<OrderCreatedEvent>(admin),
            order_completed_events: account::new_event_handle<OrderCompletedEvent>(admin),
            order_cancelled_events: account::new_event_handle<OrderCancelledEvent>(admin),
        });
    }

    /// Create a cross-chain bridge order (Aptos → Other Chain)
    public entry fun create_outbound_order<CoinType>(
        initiator: &signer,
        destination_chain_id: u64,
        recipient: vector<u8>,
        amount: u64,
        min_destination_amount: u64,
        secret_hash: vector<u8>,
        timelock_duration: u64,
        admin_addr: address,
    ) acquires CrossChainBridge {
        let initiator_addr = signer::address_of(initiator);
        
        // Validate inputs
        assert!(amount > 0, E_INVALID_AMOUNT);
        assert!(vector::length(&recipient) > 0, E_INVALID_ADDRESS);
        assert!(vector::length(&secret_hash) == 32, E_INVALID_ADDRESS);
        
        // Ensure bridge is initialized
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let bridge = borrow_global_mut<CrossChainBridge<CoinType>>(admin_addr);
        
        // Validate destination chain
        assert!(vector::contains(&bridge.supported_chains, &destination_chain_id), E_INVALID_CHAIN_ID);
        
        // Check minimum amount
        let min_amount = *table::borrow(&bridge.min_amounts, destination_chain_id);
        assert!(amount >= min_amount, E_INVALID_AMOUNT);
        
        // Calculate fee
        let fee_amount = (amount * BRIDGE_FEE_BPS) / 10000;
        let swap_amount = amount - fee_amount;
        
        // Transfer fee to fee collector
        if (fee_amount > 0) {
            coin::transfer<CoinType>(initiator, bridge.fee_collector, fee_amount);
        };
        
        // Generate order ID
        let order_id = bridge.next_order_id;
        bridge.next_order_id = order_id + 1;
        
        // Create local HTLC swap
        let local_swap_id = atomic_swap::get_next_swap_id<CoinType>(admin_addr);
        
        atomic_swap::create_swap<CoinType>(
            initiator,
            initiator_addr, // Will be updated when counterparty locks funds
            swap_amount,
            secret_hash,
            timelock_duration,
            admin_addr,
        );
        
        // Create bridge order
        let current_time = timestamp::now_seconds();
        let expiry_timestamp = current_time + timelock_duration;
        
        let order = BridgeOrder {
            id: order_id,
            source_chain_id: CHAIN_ID_APTOS,
            destination_chain_id,
            initiator: initiator_addr,
            recipient,
            source_amount: amount,
            min_destination_amount,
            secret_hash,
            expiry_timestamp,
            local_swap_id,
            remote_tx_hash: vector::empty(),
            status: 0, // Active
            created_at: current_time,
            completed_at: 0,
        };
        
        table::add(&mut bridge.orders, order_id, order);
        
        // Emit event
        event::emit_event(&mut bridge.order_created_events, OrderCreatedEvent {
            order_id,
            source_chain_id: CHAIN_ID_APTOS,
            destination_chain_id,
            initiator: initiator_addr,
            recipient,
            source_amount: amount,
            min_destination_amount,
            secret_hash,
            expiry_timestamp,
        });
    }

    /// Create a cross-chain bridge order (Other Chain → Aptos)
    public entry fun create_inbound_order<CoinType>(
        resolver: &signer,
        source_chain_id: u64,
        remote_tx_hash: vector<u8>,
        recipient: address,
        amount: u64,
        secret_hash: vector<u8>,
        timelock_duration: u64,
        admin_addr: address,
    ) acquires CrossChainBridge {
        let resolver_addr = signer::address_of(resolver);
        
        // Validate inputs
        assert!(amount > 0, E_INVALID_AMOUNT);
        assert!(vector::length(&remote_tx_hash) > 0, E_INVALID_ADDRESS);
        assert!(vector::length(&secret_hash) == 32, E_INVALID_ADDRESS);
        
        // Ensure bridge is initialized
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let bridge = borrow_global_mut<CrossChainBridge<CoinType>>(admin_addr);
        
        // Validate source chain
        assert!(vector::contains(&bridge.supported_chains, &source_chain_id), E_INVALID_CHAIN_ID);
        
        // Generate order ID
        let order_id = bridge.next_order_id;
        bridge.next_order_id = order_id + 1;
        
        // Create local HTLC swap (resolver locks Aptos tokens)
        let local_swap_id = atomic_swap::get_next_swap_id<CoinType>(admin_addr);
        atomic_swap::create_swap<CoinType>(
            resolver,
            recipient,
            amount,
            secret_hash,
            timelock_duration,
            admin_addr,
        );
        
        // Create bridge order
        let current_time = timestamp::now_seconds();
        let expiry_timestamp = current_time + timelock_duration;
        
        let order = BridgeOrder {
            id: order_id,
            source_chain_id,
            destination_chain_id: CHAIN_ID_APTOS,
            initiator: recipient, // Original initiator on source chain
            recipient: vector::empty(), // N/A for inbound orders
            source_amount: amount,
            min_destination_amount: amount,
            secret_hash,
            expiry_timestamp,
            local_swap_id,
            remote_tx_hash,
            status: 0, // Active
            created_at: current_time,
            completed_at: 0,
        };
        
        table::add(&mut bridge.orders, order_id, order);
        
        // Emit event
        event::emit_event(&mut bridge.order_created_events, OrderCreatedEvent {
            order_id,
            source_chain_id,
            destination_chain_id: CHAIN_ID_APTOS,
            initiator: recipient,
            recipient: vector::empty(),
            source_amount: amount,
            min_destination_amount: amount,
            secret_hash,
            expiry_timestamp,
        });
    }

    /// Complete a bridge order by revealing the secret
    public entry fun complete_order<CoinType>(
        user: &signer,
        order_id: u64,
        secret: vector<u8>,
        admin_addr: address,
    ) acquires CrossChainBridge {
        // Ensure bridge is initialized
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let bridge = borrow_global_mut<CrossChainBridge<CoinType>>(admin_addr);
        
        // Ensure order exists
        assert!(table::contains(&bridge.orders, order_id), E_BRIDGE_ORDER_NOT_FOUND);
        
        let order = table::borrow_mut(&mut bridge.orders, order_id);
        
        // Validate order state
        assert!(order.status == 0, E_BRIDGE_ORDER_COMPLETED);
        assert!(timestamp::now_seconds() < order.expiry_timestamp, E_TIMELOCK_EXPIRED);
        
        // Complete the local HTLC swap
        atomic_swap::complete_swap<CoinType>(user, order.local_swap_id, secret, admin_addr);
        
        // Update order state
        order.status = 1; // Completed
        order.completed_at = timestamp::now_seconds();
        
        // Emit event
        event::emit_event(&mut bridge.order_completed_events, OrderCompletedEvent {
            order_id,
            secret,
            completion_timestamp: order.completed_at,
            local_swap_id: order.local_swap_id,
            remote_tx_hash: order.remote_tx_hash,
        });
    }

    /// Cancel a bridge order after expiry
    public entry fun cancel_order<CoinType>(
        user: &signer,
        order_id: u64,
        admin_addr: address,
    ) acquires CrossChainBridge {
        // Ensure bridge is initialized
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let bridge = borrow_global_mut<CrossChainBridge<CoinType>>(admin_addr);
        
        // Ensure order exists
        assert!(table::contains(&bridge.orders, order_id), E_BRIDGE_ORDER_NOT_FOUND);
        
        let order = table::borrow_mut(&mut bridge.orders, order_id);
        
        // Validate order state
        assert!(order.status == 0, E_BRIDGE_ORDER_CANCELLED);
        assert!(timestamp::now_seconds() >= order.expiry_timestamp, E_TIMELOCK_EXPIRED);
        
        // Refund the local HTLC swap
        atomic_swap::refund_swap<CoinType>(user, order.local_swap_id, admin_addr);
        
        // Update order state
        order.status = 3; // Expired/Cancelled
        order.completed_at = timestamp::now_seconds();
        
        // Emit event
        event::emit_event(&mut bridge.order_cancelled_events, OrderCancelledEvent {
            order_id,
            cancellation_timestamp: order.completed_at,
            reason: string::utf8(b"Expired"),
        });
    }

    //===================================================================================
    // View Functions
    //===================================================================================

    /// Get bridge order details
    #[view]
    public fun get_order<CoinType>(admin_addr: address, order_id: u64): BridgeOrder acquires CrossChainBridge {
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let bridge = borrow_global<CrossChainBridge<CoinType>>(admin_addr);
        assert!(table::contains(&bridge.orders, order_id), E_BRIDGE_ORDER_NOT_FOUND);
        *table::borrow(&bridge.orders, order_id)
    }

    /// Check if order exists
    #[view]
    public fun order_exists<CoinType>(admin_addr: address, order_id: u64): bool acquires CrossChainBridge {
        if (!exists<CrossChainBridge<CoinType>>(admin_addr)) {
            return false
        };
        let bridge = borrow_global<CrossChainBridge<CoinType>>(admin_addr);
        table::contains(&bridge.orders, order_id)
    }

    /// Get supported chains
    #[view]
    public fun get_supported_chains<CoinType>(admin_addr: address): vector<u64> acquires CrossChainBridge {
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let bridge = borrow_global<CrossChainBridge<CoinType>>(admin_addr);
        bridge.supported_chains
    }

    /// Get minimum amount for a chain
    #[view]
    public fun get_min_amount<CoinType>(admin_addr: address, chain_id: u64): u64 acquires CrossChainBridge {
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let bridge = borrow_global<CrossChainBridge<CoinType>>(admin_addr);
        *table::borrow(&bridge.min_amounts, chain_id)
    }

    /// Get next order ID
    #[view]
    public fun get_next_order_id<CoinType>(admin_addr: address): u64 acquires CrossChainBridge {
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let bridge = borrow_global<CrossChainBridge<CoinType>>(admin_addr);
        bridge.next_order_id
    }

    /// Calculate bridge fee for an amount
    #[view]
    public fun calculate_fee(amount: u64): u64 {
        (amount * BRIDGE_FEE_BPS) / 10000
    }

    //===================================================================================
    // Admin Functions
    //===================================================================================

    /// Update minimum amount for a chain (admin only)
    public entry fun update_min_amount<CoinType>(
        admin: &signer,
        chain_id: u64,
        min_amount: u64,
    ) acquires CrossChainBridge {
        let admin_addr = signer::address_of(admin);
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let bridge = borrow_global_mut<CrossChainBridge<CoinType>>(admin_addr);
        
        if (table::contains(&bridge.min_amounts, chain_id)) {
            let min_amount_ref = table::borrow_mut(&mut bridge.min_amounts, chain_id);
            *min_amount_ref = min_amount;
        } else {
            table::add(&mut bridge.min_amounts, chain_id, min_amount);
        };
    }

    /// Add supported chain (admin only)
    public entry fun add_supported_chain<CoinType>(
        admin: &signer,
        chain_id: u64,
        min_amount: u64,
    ) acquires CrossChainBridge {
        let admin_addr = signer::address_of(admin);
        assert!(exists<CrossChainBridge<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let bridge = borrow_global_mut<CrossChainBridge<CoinType>>(admin_addr);
        
        // Add to supported chains if not already present
        if (!vector::contains(&bridge.supported_chains, &chain_id)) {
            vector::push_back(&mut bridge.supported_chains, chain_id);
        };
        
        // Set minimum amount
        if (!table::contains(&bridge.min_amounts, chain_id)) {
            table::add(&mut bridge.min_amounts, chain_id, min_amount);
        };
    }
} 