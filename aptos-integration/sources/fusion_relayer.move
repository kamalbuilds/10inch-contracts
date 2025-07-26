module fusion_swap::fusion_relayer {
    use std::signer;
    use std::vector;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::timestamp;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::account;
    use aptos_std::table::{Self, Table};
    use fusion_swap::fusion_htlc;

    // Error codes
    const E_NOT_INITIALIZED: u64 = 100;
    const E_ALREADY_EXISTS: u64 = 101;
    const E_NOT_FOUND: u64 = 102;
    const E_NOT_RELAYER: u64 = 103;
    const E_NOT_OWNER: u64 = 104;
    const E_ALREADY_COMPLETED: u64 = 105;
    const E_INSUFFICIENT_DEPOSIT: u64 = 106;
    const E_INVALID_CHAIN: u64 = 107;

    // Cross-chain order state
    struct CrossChainOrder<phantom CoinType> has store {
        order_id: u64,
        initiator: address,
        src_chain: u8,
        dst_chain: u8,
        src_amount: u64,
        dst_amount: u64,
        dst_recipient: vector<u8>, // Address on destination chain
        secret_hash: vector<u8>,
        safety_deposit: u64,
        relayer: address,
        src_htlc_id: u64,
        dst_tx_hash: vector<u8>,
        created_at: u64,
        completed: bool,
        cancelled: bool,
    }

    // Relayer state
    struct RelayerState<phantom CoinType> has key {
        orders: Table<u64, CrossChainOrder<CoinType>>,
        escrow_balance: Coin<CoinType>,
        safety_deposits: Table<address, u64>,
        next_order_id: u64,
        htlc_module: address,
        relayers: vector<address>,
        owner: address,
        deploy_events: EventHandle<DeployEvent>,
        withdraw_events: EventHandle<WithdrawEvent>,
        cancel_events: EventHandle<CancelEvent>,
    }

    // Events
    struct DeployEvent has drop, store {
        order_id: u64,
        initiator: address,
        dst_chain: u8,
        amount: u64,
        secret_hash: vector<u8>,
    }

    struct WithdrawEvent has drop, store {
        order_id: u64,
        relayer: address,
        secret: vector<u8>,
    }

    struct CancelEvent has drop, store {
        order_id: u64,
        initiator: address,
    }

    // Initialize relayer module
    public entry fun initialize<CoinType>(
        owner: &signer,
        htlc_module: address
    ) {
        let addr = signer::address_of(owner);
        assert!(!exists<RelayerState<CoinType>>(addr), E_ALREADY_EXISTS);

        move_to(owner, RelayerState<CoinType> {
            orders: table::new(),
            escrow_balance: coin::zero<CoinType>(),
            safety_deposits: table::new(),
            next_order_id: 1,
            htlc_module,
            relayers: vector::empty(),
            owner: addr,
            deploy_events: account::new_event_handle<DeployEvent>(owner),
            withdraw_events: account::new_event_handle<WithdrawEvent>(owner),
            cancel_events: account::new_event_handle<CancelEvent>(owner),
        });
    }

    // Add a relayer
    public entry fun add_relayer<CoinType>(
        owner: &signer,
        module_addr: address,
        relayer: address
    ) acquires RelayerState {
        let owner_addr = signer::address_of(owner);
        let state = borrow_global_mut<RelayerState<CoinType>>(module_addr);
        assert!(state.owner == owner_addr, E_NOT_OWNER);
        
        if (!vector::contains(&state.relayers, &relayer)) {
            vector::push_back(&mut state.relayers, relayer);
        }
    }

    // Deploy source HTLC and create order
    public entry fun deploy_source<CoinType>(
        initiator: &signer,
        module_addr: address,
        dst_chain: u8,
        dst_recipient: vector<u8>,
        src_amount: u64,
        dst_amount: u64,
        secret_hash: vector<u8>,
        timelock: u64,
        safety_deposit: u64,
    ) acquires RelayerState {
        let initiator_addr = signer::address_of(initiator);
        let state = borrow_global_mut<RelayerState<CoinType>>(module_addr);
        
        // Create HTLC on source chain
        fusion_htlc::create_htlc<CoinType>(
            initiator,
            state.htlc_module,
            module_addr, // Relayer is recipient
            src_amount,
            secret_hash,
            timelock
        );

        // Get HTLC ID
        let htlc_id = fusion_htlc::get_next_id<CoinType>(state.htlc_module) - 1;

        // Collect safety deposit
        let deposit = coin::withdraw<CoinType>(initiator, safety_deposit);
        coin::merge(&mut state.escrow_balance, deposit);

        // Create order
        let order_id = state.next_order_id;
        state.next_order_id = state.next_order_id + 1;

        let order = CrossChainOrder<CoinType> {
            order_id,
            initiator: initiator_addr,
            src_chain: 1, // Aptos chain ID
            dst_chain,
            src_amount,
            dst_amount,
            dst_recipient,
            secret_hash,
            safety_deposit,
            relayer: @0x0, // Not assigned yet
            src_htlc_id: htlc_id,
            dst_tx_hash: vector::empty(),
            created_at: timestamp::now_seconds(),
            completed: false,
            cancelled: false,
        };

        table::add(&mut state.orders, order_id, order);

        // Update safety deposits tracking
        if (table::contains(&state.safety_deposits, initiator_addr)) {
            let current = table::borrow_mut(&mut state.safety_deposits, initiator_addr);
            *current = *current + safety_deposit;
        } else {
            table::add(&mut state.safety_deposits, initiator_addr, safety_deposit);
        };

        event::emit_event(&mut state.deploy_events, DeployEvent {
            order_id,
            initiator: initiator_addr,
            dst_chain,
            amount: src_amount,
            secret_hash,
        });
    }

    // Relayer deploys on destination and withdraws from source
    public entry fun withdraw_source<CoinType>(
        relayer: &signer,
        module_addr: address,
        order_id: u64,
        secret: vector<u8>,
        dst_tx_hash: vector<u8>,
    ) acquires RelayerState {
        let relayer_addr = signer::address_of(relayer);
        let state = borrow_global_mut<RelayerState<CoinType>>(module_addr);
        
        // Verify relayer
        assert!(vector::contains(&state.relayers, &relayer_addr), E_NOT_RELAYER);
        
        // Get order
        assert!(table::contains(&state.orders, order_id), E_NOT_FOUND);
        let order = table::borrow_mut(&mut state.orders, order_id);
        assert!(!order.completed && !order.cancelled, E_ALREADY_COMPLETED);

        // Update order
        order.relayer = relayer_addr;
        order.dst_tx_hash = dst_tx_hash;
        order.completed = true;

        // Complete source HTLC to get funds
        fusion_htlc::complete_htlc<CoinType>(
            relayer,
            state.htlc_module,
            order.src_htlc_id,
            secret
        );

        // Return safety deposit to initiator
        let deposit = coin::extract(&mut state.escrow_balance, order.safety_deposit);
        coin::deposit(order.initiator, deposit);

        // Update deposits tracking
        let deposits = table::borrow_mut(&mut state.safety_deposits, order.initiator);
        *deposits = *deposits - order.safety_deposit;

        event::emit_event(&mut state.withdraw_events, WithdrawEvent {
            order_id,
            relayer: relayer_addr,
            secret,
        });
    }

    // Cancel expired order
    public entry fun cancel_order<CoinType>(
        initiator: &signer,
        module_addr: address,
        order_id: u64,
    ) acquires RelayerState {
        let initiator_addr = signer::address_of(initiator);
        let state = borrow_global_mut<RelayerState<CoinType>>(module_addr);
        
        assert!(table::contains(&state.orders, order_id), E_NOT_FOUND);
        let order = table::borrow_mut(&mut state.orders, order_id);
        
        assert!(order.initiator == initiator_addr, E_NOT_OWNER);
        assert!(!order.completed && !order.cancelled, E_ALREADY_COMPLETED);

        // Try to refund from HTLC
        fusion_htlc::refund_htlc<CoinType>(
            initiator,
            state.htlc_module,
            order.src_htlc_id
        );

        // Return safety deposit
        let deposit = coin::extract(&mut state.escrow_balance, order.safety_deposit);
        coin::deposit(initiator_addr, deposit);

        // Update order and tracking
        order.cancelled = true;
        let deposits = table::borrow_mut(&mut state.safety_deposits, initiator_addr);
        *deposits = *deposits - order.safety_deposit;

        event::emit_event(&mut state.cancel_events, CancelEvent {
            order_id,
            initiator: initiator_addr,
        });
    }

    // View functions
    #[view]
    public fun get_order<CoinType>(
        module_addr: address,
        order_id: u64
    ): (u64, address, u8, u8, u64, u64, bool, bool) acquires RelayerState {
        let state = borrow_global<RelayerState<CoinType>>(module_addr);
        assert!(table::contains(&state.orders, order_id), E_NOT_FOUND);
        
        let order = table::borrow(&state.orders, order_id);
        (
            order.order_id,
            order.initiator,
            order.src_chain,
            order.dst_chain,
            order.src_amount,
            order.dst_amount,
            order.completed,
            order.cancelled
        )
    }

    #[view]
    public fun is_relayer<CoinType>(
        module_addr: address,
        addr: address
    ): bool acquires RelayerState {
        let state = borrow_global<RelayerState<CoinType>>(module_addr);
        vector::contains(&state.relayers, &addr)
    }
}