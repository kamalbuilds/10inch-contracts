module fusion_swap::fusion_relayer_v2 {
    use std::signer;
    use std::vector;
    use std::bcs;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::timestamp;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::account;
    use aptos_std::table::{Self, Table};
    use fusion_swap::fusion_escrow_simple;

    // Error codes
    const E_NOT_INITIALIZED: u64 = 100;
    const E_ALREADY_EXISTS: u64 = 101;
    const E_NOT_FOUND: u64 = 102;
    const E_NOT_RELAYER: u64 = 103;
    const E_NOT_OWNER: u64 = 104;
    const E_ALREADY_COMPLETED: u64 = 105;
    const E_INSUFFICIENT_AMOUNT: u64 = 106;
    const E_INVALID_CHAIN: u64 = 107;
    const E_ORDER_EXPIRED: u64 = 108;
    const E_INVALID_SECRET: u64 = 109;

    // Chain IDs
    const CHAIN_APTOS: u8 = 0;
    const CHAIN_ETHEREUM: u8 = 1;
    const CHAIN_BSC: u8 = 2;
    const CHAIN_POLYGON: u8 = 3;

    // Order types
    const ORDER_TYPE_OUTBOUND: u8 = 0; // Aptos -> EVM
    const ORDER_TYPE_INBOUND: u8 = 1;  // EVM -> Aptos

    // Unified order structure for both directions
    struct Order<phantom CoinType> has store {
        order_id: u64,
        order_type: u8, // 0 = outbound (Aptos->EVM), 1 = inbound (EVM->Aptos)
        initiator: address,
        src_chain: u8,
        dst_chain: u8,
        src_amount: u64,
        dst_amount: u64,
        src_address: vector<u8>, // Can be Aptos address or EVM address
        dst_address: vector<u8>, // Can be Aptos address or EVM address
        secret_hash: vector<u8>,
        expiry: u64,
        escrow_address: address, // Aptos escrow object address
        relayer_fee: u64,
        safety_deposit: u64,
        relayer: address,
        status: u8, // 0=created, 1=escrowed, 2=completed, 3=cancelled, 4=expired
        created_at: u64,
        completed_at: u64,
    }

    // Relayer hub state
    struct RelayerHub<phantom CoinType> has key {
        orders: Table<u64, Order<CoinType>>,
        outbound_orders: vector<u64>, // Aptos -> EVM
        inbound_orders: vector<u64>,  // EVM -> Aptos
        relayer_balance: Coin<CoinType>, // Relayer's working capital
        collected_fees: Coin<CoinType>,
        next_order_id: u64,
        relayers: vector<address>,
        owner: address,
        min_safety_deposit: u64,
        base_relayer_fee: u64,
        
        // Events
        order_created_events: EventHandle<OrderCreatedEvent>,
        order_escrowed_events: EventHandle<OrderEscrowedEvent>,
        order_completed_events: EventHandle<OrderCompletedEvent>,
        order_cancelled_events: EventHandle<OrderCancelledEvent>,
    }

    // Events
    struct OrderCreatedEvent has drop, store {
        order_id: u64,
        order_type: u8,
        initiator: address,
        src_chain: u8,
        dst_chain: u8,
        amount: u64,
        secret_hash: vector<u8>,
    }

    struct OrderEscrowedEvent has drop, store {
        order_id: u64,
        escrow_address: address,
        relayer: address,
    }

    struct OrderCompletedEvent has drop, store {
        order_id: u64,
        secret: vector<u8>,
        relayer: address,
    }

    struct OrderCancelledEvent has drop, store {
        order_id: u64,
        reason: u8, // 0=user_cancelled, 1=expired
    }

    // Initialize relayer hub
    public entry fun initialize<CoinType>(
        owner: &signer,
        min_safety_deposit: u64,
        base_relayer_fee: u64,
    ) {
        let addr = signer::address_of(owner);
        assert!(!exists<RelayerHub<CoinType>>(addr), E_ALREADY_EXISTS);

        move_to(owner, RelayerHub<CoinType> {
            orders: table::new(),
            outbound_orders: vector::empty(),
            inbound_orders: vector::empty(),
            relayer_balance: coin::zero<CoinType>(),
            collected_fees: coin::zero<CoinType>(),
            next_order_id: 1,
            relayers: vector::singleton(addr),
            owner: addr,
            min_safety_deposit,
            base_relayer_fee,
            order_created_events: account::new_event_handle<OrderCreatedEvent>(owner),
            order_escrowed_events: account::new_event_handle<OrderEscrowedEvent>(owner),
            order_completed_events: account::new_event_handle<OrderCompletedEvent>(owner),
            order_cancelled_events: account::new_event_handle<OrderCancelledEvent>(owner),
        });
    }

    // Create outbound order (Aptos -> EVM)
    public entry fun create_outbound_order<CoinType>(
        user: &signer,
        hub_addr: address,
        amount: u64,
        dst_chain: u8,
        dst_address: vector<u8>, // EVM address
        secret_hash: vector<u8>,
        expiry_seconds: u64,
        safety_deposit: u64,
    ) acquires RelayerHub {
        let hub = borrow_global_mut<RelayerHub<CoinType>>(hub_addr);
        let user_addr = signer::address_of(user);
        
        assert!(safety_deposit >= hub.min_safety_deposit, E_INSUFFICIENT_AMOUNT);
        assert!(dst_chain != CHAIN_APTOS, E_INVALID_CHAIN);
        
        let order_id = hub.next_order_id;
        hub.next_order_id = order_id + 1;
        
        let expiry = timestamp::now_seconds() + expiry_seconds;
        let src_address = bcs::to_bytes(&user_addr);
        
        // Create escrow for user's funds
        fusion_escrow_simple::create_escrow<CoinType>(
            user,
            hub_addr,
            amount + safety_deposit,
            hub_addr, // Hub acts as relayer for escrow
            secret_hash,
            expiry,
            dst_chain,
            dst_address,
        );
        
        // The escrow address would be deterministic based on user address and nonce
        // For simplicity, we'll track it in the order
        let escrow_address = user_addr; // This should be the actual escrow object address
        
        let order = Order<CoinType> {
            order_id,
            order_type: ORDER_TYPE_OUTBOUND,
            initiator: user_addr,
            src_chain: CHAIN_APTOS,
            dst_chain,
            src_amount: amount,
            dst_amount: amount, // Relayer will set actual dst amount
            src_address,
            dst_address,
            secret_hash,
            expiry,
            escrow_address,
            relayer_fee: hub.base_relayer_fee,
            safety_deposit,
            relayer: @0x0, // To be assigned
            status: 1, // Escrowed
            created_at: timestamp::now_seconds(),
            completed_at: 0,
        };
        
        table::add(&mut hub.orders, order_id, order);
        vector::push_back(&mut hub.outbound_orders, order_id);
        
        event::emit_event(&mut hub.order_created_events, OrderCreatedEvent {
            order_id,
            order_type: ORDER_TYPE_OUTBOUND,
            initiator: user_addr,
            src_chain: CHAIN_APTOS,
            dst_chain,
            amount,
            secret_hash,
        });
    }

    // Create inbound order (EVM -> Aptos)
    public entry fun create_inbound_order<CoinType>(
        relayer: &signer,
        hub_addr: address,
        src_chain: u8,
        src_address: vector<u8>, // EVM address
        src_amount: u64,
        dst_address: address, // Aptos recipient
        dst_amount: u64,
        secret_hash: vector<u8>,
        expiry_seconds: u64,
    ) acquires RelayerHub {
        let hub = borrow_global_mut<RelayerHub<CoinType>>(hub_addr);
        let relayer_addr = signer::address_of(relayer);
        
        // Verify relayer
        assert!(vector::contains(&hub.relayers, &relayer_addr), E_NOT_RELAYER);
        assert!(src_chain != CHAIN_APTOS, E_INVALID_CHAIN);
        
        let order_id = hub.next_order_id;
        hub.next_order_id = order_id + 1;
        
        let expiry = timestamp::now_seconds() + expiry_seconds;
        let dst_address_bytes = bcs::to_bytes(&dst_address);
        
        // Relayer deposits funds to hub
        let deposit = coin::withdraw<CoinType>(relayer, dst_amount + hub.base_relayer_fee);
        coin::merge(&mut hub.relayer_balance, deposit);
        
        let order = Order<CoinType> {
            order_id,
            order_type: ORDER_TYPE_INBOUND,
            initiator: dst_address, // Recipient on Aptos
            src_chain,
            dst_chain: CHAIN_APTOS,
            src_amount,
            dst_amount,
            src_address,
            dst_address: dst_address_bytes,
            secret_hash,
            expiry,
            escrow_address: hub_addr, // Hub holds the funds
            relayer_fee: hub.base_relayer_fee,
            safety_deposit: 0, // No safety deposit for inbound
            relayer: relayer_addr,
            status: 1, // Escrowed (relayer already deposited)
            created_at: timestamp::now_seconds(),
            completed_at: 0,
        };
        
        table::add(&mut hub.orders, order_id, order);
        vector::push_back(&mut hub.inbound_orders, order_id);
        
        event::emit_event(&mut hub.order_created_events, OrderCreatedEvent {
            order_id,
            order_type: ORDER_TYPE_INBOUND,
            initiator: dst_address,
            src_chain,
            dst_chain: CHAIN_APTOS,
            amount: dst_amount,
            secret_hash,
        });
    }

    // Relayer picks up outbound order
    public entry fun pick_outbound_order<CoinType>(
        relayer: &signer,
        hub_addr: address,
        order_id: u64,
        dst_amount: u64,
    ) acquires RelayerHub {
        let hub = borrow_global_mut<RelayerHub<CoinType>>(hub_addr);
        let relayer_addr = signer::address_of(relayer);
        
        assert!(vector::contains(&hub.relayers, &relayer_addr), E_NOT_RELAYER);
        assert!(table::contains(&hub.orders, order_id), E_NOT_FOUND);
        
        let order = table::borrow_mut(&mut hub.orders, order_id);
        assert!(order.order_type == ORDER_TYPE_OUTBOUND, E_INVALID_CHAIN);
        assert!(order.status == 1, E_ALREADY_COMPLETED);
        assert!(timestamp::now_seconds() < order.expiry, E_ORDER_EXPIRED);
        
        // Update order with relayer info
        order.relayer = relayer_addr;
        order.dst_amount = dst_amount;
        
        event::emit_event(&mut hub.order_escrowed_events, OrderEscrowedEvent {
            order_id,
            escrow_address: order.escrow_address,
            relayer: relayer_addr,
        });
    }

    // Complete outbound order with secret (relayer claims from escrow)
    public entry fun complete_outbound_order<CoinType>(
        relayer: &signer,
        hub_addr: address,
        order_id: u64,
        secret: vector<u8>,
    ) acquires RelayerHub {
        let hub = borrow_global_mut<RelayerHub<CoinType>>(hub_addr);
        let relayer_addr = signer::address_of(relayer);
        
        assert!(table::contains(&hub.orders, order_id), E_NOT_FOUND);
        
        let order = table::borrow_mut(&mut hub.orders, order_id);
        assert!(order.order_type == ORDER_TYPE_OUTBOUND, E_INVALID_CHAIN);
        assert!(order.relayer == relayer_addr, E_NOT_RELAYER);
        assert!(order.status == 1, E_ALREADY_COMPLETED);
        
        // Claim from escrow
        fusion_escrow_simple::claim_with_secret<CoinType>(
            relayer,
            hub_addr,
            order_id,
            secret,
        );
        
        order.status = 2; // Completed
        order.completed_at = timestamp::now_seconds();
        
        event::emit_event(&mut hub.order_completed_events, OrderCompletedEvent {
            order_id,
            secret,
            relayer: relayer_addr,
        });
    }

    // Complete inbound order with secret (user receives funds)
    public entry fun complete_inbound_order<CoinType>(
        user: &signer,
        hub_addr: address,
        order_id: u64,
        secret: vector<u8>,
    ) acquires RelayerHub {
        let hub = borrow_global_mut<RelayerHub<CoinType>>(hub_addr);
        let user_addr = signer::address_of(user);
        
        assert!(table::contains(&hub.orders, order_id), E_NOT_FOUND);
        
        let order = table::borrow_mut(&mut hub.orders, order_id);
        assert!(order.order_type == ORDER_TYPE_INBOUND, E_INVALID_CHAIN);
        assert!(order.initiator == user_addr, E_NOT_OWNER);
        assert!(order.status == 1, E_ALREADY_COMPLETED);
        
        // Verify secret
        let secret_hash = aptos_std::hash::sha2_256(secret);
        assert!(secret_hash == order.secret_hash, E_INVALID_SECRET);
        
        // Transfer funds from hub to user
        let payment = coin::extract(&mut hub.relayer_balance, order.dst_amount);
        coin::deposit(user_addr, payment);
        
        // Collect relayer fee
        let fee = coin::extract(&mut hub.relayer_balance, order.relayer_fee);
        coin::merge(&mut hub.collected_fees, fee);
        
        order.status = 2; // Completed
        order.completed_at = timestamp::now_seconds();
        
        event::emit_event(&mut hub.order_completed_events, OrderCompletedEvent {
            order_id,
            secret,
            relayer: order.relayer,
        });
    }

    // Cancel expired outbound order (user reclaims)
    public entry fun cancel_expired_order<CoinType>(
        user: &signer,
        hub_addr: address,
        order_id: u64,
    ) acquires RelayerHub {
        let hub = borrow_global_mut<RelayerHub<CoinType>>(hub_addr);
        let user_addr = signer::address_of(user);
        
        assert!(table::contains(&hub.orders, order_id), E_NOT_FOUND);
        
        let order = table::borrow_mut(&mut hub.orders, order_id);
        assert!(order.initiator == user_addr, E_NOT_OWNER);
        assert!(order.status == 1, E_ALREADY_COMPLETED);
        assert!(timestamp::now_seconds() >= order.expiry, E_ORDER_EXPIRED);
        
        // User reclaims from escrow
        fusion_escrow_simple::reclaim_expired<CoinType>(
            user,
            hub_addr,
            order_id,
        );
        
        order.status = 4; // Expired
        
        event::emit_event(&mut hub.order_cancelled_events, OrderCancelledEvent {
            order_id,
            reason: 1, // Expired
        });
    }

    // View functions
    public fun get_order_info<CoinType>(hub_addr: address, order_id: u64): (u8, u64, u8, u8, address, u8) acquires RelayerHub {
        let hub = borrow_global<RelayerHub<CoinType>>(hub_addr);
        let order = table::borrow(&hub.orders, order_id);
        (order.order_type, order.src_amount, order.src_chain, order.dst_chain, order.initiator, order.status)
    }
}