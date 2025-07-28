// Copyright (c) 1inch Network
// SPDX-License-Identifier: MIT

/// Cross-chain swap manager for 1inch Fusion+ on Sui
/// Handles bidirectional swaps between Sui and EVM chains
module fusion_swap::fusion_cross_chain {
    use std::vector;
    use std::option::{Self, Option};
    use std::string::{Self, String};
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::coin::{Self, Coin};
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::table::{Self, Table};
    use fusion_swap::fusion_htlc_v2::{Self, HTLC};

    // ============ Error Codes ============
    const E_INVALID_CHAIN: u64 = 2001;
    const E_INVALID_ORDER: u64 = 2002;
    const E_ORDER_EXISTS: u64 = 2003;
    const E_ORDER_NOT_FOUND: u64 = 2004;
    const E_INVALID_AMOUNT: u64 = 2005;
    const E_NOT_RESOLVER: u64 = 2006;
    const E_ALREADY_COMPLETED: u64 = 2007;

    // ============ Constants ============
    const CHAIN_ETHEREUM_SEPOLIA: u64 = 11155111;
    const CHAIN_ETHEREUM: u8 = 1;
    const CHAIN_BSC: u8 = 56;
    const CHAIN_POLYGON: u8 = 137;
    const CHAIN_ARBITRUM: u64 = 42161;
    const CHAIN_OPTIMISM: u8 = 10;
    const CHAIN_BASE: u64 = 8453;
    const CHAIN_SUI: u8 = 101; // Custom ID for Sui

    const ORDER_TYPE_OUTBOUND: u8 = 0; // Sui -> EVM
    const ORDER_TYPE_INBOUND: u8 = 1;  // EVM -> Sui

    const MIN_SWAP_AMOUNT: u64 = 1000000; // 0.001 SUI minimum

    // ============ Structs ============

    /// Cross-chain order details
    struct CrossChainOrder has store, copy, drop {
        order_id: ID,
        order_type: u8,
        source_chain: u64,
        dest_chain: u64,
        sender: address,
        receiver: address,
        source_amount: u64,
        dest_amount: u64,
        hashlock: vector<u8>,
        timelock: u64,
        htlc_id: Option<ID>,
        resolver: Option<address>,
        created_at: u64,
        completed: bool,
    }

    /// Cross-chain swap registry
    struct SwapRegistry has key {
        id: UID,
        orders: Table<ID, CrossChainOrder>,
        resolvers: Table<address, bool>,
        total_volume: u64,
        order_count: u64,
    }

    /// Resolver info
    struct ResolverInfo has key, store {
        id: UID,
        resolver: address,
        active: bool,
        completed_swaps: u64,
        total_volume: u64,
    }

    // ============ Events ============

    struct OrderCreated has copy, drop {
        order_id: ID,
        order_type: u8,
        source_chain: u64,
        dest_chain: u64,
        sender: address,
        receiver: address,
        amount: u64,
        hashlock: vector<u8>,
        created_at: u64,
    }

    struct OrderAccepted has copy, drop {
        order_id: ID,
        resolver: address,
        htlc_id: ID,
        accepted_at: u64,
    }

    struct OrderCompleted has copy, drop {
        order_id: ID,
        secret: vector<u8>,
        completed_at: u64,
    }

    // ============ Init ============

    fun init(ctx: &mut TxContext) {
        let registry = SwapRegistry {
            id: object::new(ctx),
            orders: table::new(ctx),
            resolvers: table::new(ctx),
            total_volume: 0,
            order_count: 0,
        };
        transfer::share_object(registry);
    }

    // ============ Core Functions ============

    /// Create outbound order (Sui -> EVM)
    public fun create_outbound_order(
        registry: &mut SwapRegistry,
        dest_chain: u64,
        receiver: address,
        amount: u64,
        hashlock: vector<u8>,
        timelock: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): ID {
        let sender = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);
        
        // Validate
        assert!(is_valid_evm_chain(dest_chain), E_INVALID_CHAIN);
        assert!(amount >= MIN_SWAP_AMOUNT, E_INVALID_AMOUNT);
        assert!(vector::length(&hashlock) == 32, E_INVALID_ORDER);

        let order_uid = object::new(ctx);
        let order_id = object::uid_to_inner(&order_uid);
        object::delete(order_uid);

        let order = CrossChainOrder {
            order_id,
            order_type: ORDER_TYPE_OUTBOUND,
            source_chain: (CHAIN_SUI as u64),
            dest_chain,
            sender,
            receiver,
            source_amount: amount,
            dest_amount: amount, // Simplified 1:1 for demo
            hashlock,
            timelock,
            htlc_id: option::none(),
            resolver: option::none(),
            created_at: current_time,
            completed: false,
        };

        table::add(&mut registry.orders, order_id, order);
        registry.order_count = registry.order_count + 1;

        event::emit(OrderCreated {
            order_id,
            order_type: ORDER_TYPE_OUTBOUND,
            source_chain: (CHAIN_SUI as u64),
            dest_chain,
            sender,
            receiver,
            amount,
            hashlock,
            created_at: current_time,
        });

        order_id
    }

    /// Create inbound order (EVM -> Sui)
    public fun create_inbound_order(
        registry: &mut SwapRegistry,
        source_chain: u64,
        sender: address,
        receiver: address,
        amount: u64,
        hashlock: vector<u8>,
        timelock: u64,
        evm_tx_hash: String,
        clock: &Clock,
        ctx: &mut TxContext
    ): ID {
        let current_time = clock::timestamp_ms(clock);
        
        // Validate
        assert!(is_valid_evm_chain(source_chain), E_INVALID_CHAIN);
        assert!(amount >= MIN_SWAP_AMOUNT, E_INVALID_AMOUNT);
        assert!(vector::length(&hashlock) == 32, E_INVALID_ORDER);
        assert!(string::length(&evm_tx_hash) > 0, E_INVALID_ORDER);

        let order_uid = object::new(ctx);
        let order_id = object::uid_to_inner(&order_uid);
        object::delete(order_uid);

        let order = CrossChainOrder {
            order_id,
            order_type: ORDER_TYPE_INBOUND,
            source_chain,
            dest_chain: (CHAIN_SUI as u64),
            sender,
            receiver,
            source_amount: amount,
            dest_amount: amount, // Simplified 1:1 for demo
            hashlock,
            timelock,
            htlc_id: option::none(),
            resolver: option::none(),
            created_at: current_time,
            completed: false,
        };

        table::add(&mut registry.orders, order_id, order);
        registry.order_count = registry.order_count + 1;

        event::emit(OrderCreated {
            order_id,
            order_type: ORDER_TYPE_INBOUND,
            source_chain,
            dest_chain: (CHAIN_SUI as u64),
            sender,
            receiver,
            amount,
            hashlock,
            created_at: current_time,
        });

        order_id
    }

    /// Resolver accepts order and creates HTLC
    public fun accept_order<T>(
        registry: &mut SwapRegistry,
        order_id: ID,
        payment: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ): ID {
        let resolver = tx_context::sender(ctx);
        
        // Get order
        assert!(table::contains(&registry.orders, order_id), E_ORDER_NOT_FOUND);
        let order = table::borrow_mut(&mut registry.orders, order_id);
        
        // Validate
        assert!(!order.completed, E_ALREADY_COMPLETED);
        assert!(option::is_none(&order.htlc_id), E_ORDER_EXISTS);
        assert!(coin::value(&payment) >= order.dest_amount, E_INVALID_AMOUNT);

        // Create HTLC based on order type
        let htlc_receiver = if (order.order_type == ORDER_TYPE_OUTBOUND) {
            order.receiver // For outbound, funds go to EVM receiver's Sui address
        } else {
            order.receiver // For inbound, funds go to Sui receiver
        };

        let htlc_id = fusion_htlc_v2::create_htlc(
            payment,
            htlc_receiver,
            order.hashlock,
            order.timelock,
            clock,
            ctx
        );

        // Update order
        order.htlc_id = option::some(htlc_id);
        order.resolver = option::some(resolver);

        // Create resolver info if new
        if (!table::contains(&registry.resolvers, resolver)) {
            table::add(&mut registry.resolvers, resolver, true);
            let resolver_info = ResolverInfo {
                id: object::new(ctx),
                resolver,
                active: true,
                completed_swaps: 0,
                total_volume: 0,
            };
            transfer::transfer(resolver_info, resolver);
        };

        event::emit(OrderAccepted {
            order_id,
            resolver,
            htlc_id,
            accepted_at: clock::timestamp_ms(clock),
        });

        htlc_id
    }

    /// Complete order with secret
    public fun complete_order(
        registry: &mut SwapRegistry,
        order_id: ID,
        secret: vector<u8>,
        clock: &Clock,
        _ctx: &mut TxContext
    ) {
        // Get order
        assert!(table::contains(&registry.orders, order_id), E_ORDER_NOT_FOUND);
        let order = table::borrow_mut(&mut registry.orders, order_id);
        
        // Validate
        assert!(!order.completed, E_ALREADY_COMPLETED);
        assert!(option::is_some(&order.htlc_id), E_INVALID_ORDER);

        // Mark as completed
        order.completed = true;
        registry.total_volume = registry.total_volume + order.source_amount;

        event::emit(OrderCompleted {
            order_id,
            secret,
            completed_at: clock::timestamp_ms(clock),
        });
    }

    // ============ View Functions ============

    /// Get order details
    public fun get_order(registry: &SwapRegistry, order_id: ID): &CrossChainOrder {
        table::borrow(&registry.orders, order_id)
    }

    /// Check if order exists
    public fun order_exists(registry: &SwapRegistry, order_id: ID): bool {
        table::contains(&registry.orders, order_id)
    }

    /// Get registry stats
    public fun get_stats(registry: &SwapRegistry): (u64, u64) {
        (registry.order_count, registry.total_volume)
    }

    /// Check if valid EVM chain
    fun is_valid_evm_chain(chain_id: u64): bool {
        chain_id == (CHAIN_ETHEREUM as u64) ||
        chain_id == (CHAIN_BSC as u64) ||
        chain_id == (CHAIN_POLYGON as u64) ||
        chain_id == CHAIN_ARBITRUM ||
        chain_id == (CHAIN_OPTIMISM as u64) ||
        chain_id == CHAIN_BASE ||
        chain_id == CHAIN_ETHEREUM_SEPOLIA
    }

    // ============ Test Functions ============

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}