module fusion_swap::fusion_htlc {
    use std::signer;
    use std::vector;
    use std::hash;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::timestamp;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::account;
    use aptos_std::table::{Self, Table};

    // Error codes
    const E_NOT_INITIALIZED: u64 = 1;
    const E_ALREADY_EXISTS: u64 = 2;
    const E_NOT_FOUND: u64 = 3;
    const E_INVALID_SECRET: u64 = 4;
    const E_NOT_EXPIRED: u64 = 5;
    const E_EXPIRED: u64 = 6;
    const E_NOT_PARTICIPANT: u64 = 7;
    const E_ALREADY_COMPLETED: u64 = 8;
    const E_INSUFFICIENT_AMOUNT: u64 = 9;

    // HTLC State
    struct HTLCState<phantom CoinType> has store {
        initiator: address,
        recipient: address,
        amount: u64,
        hashlock: vector<u8>,
        timelock: u64,
        secret: vector<u8>,
        completed: bool,
        refunded: bool,
    }

    // Global state
    struct GlobalState<phantom CoinType> has key {
        htlcs: Table<u64, HTLCState<CoinType>>,
        escrow_balance: Coin<CoinType>,
        next_id: u64,
        create_events: EventHandle<CreateEvent>,
        complete_events: EventHandle<CompleteEvent>,
        refund_events: EventHandle<RefundEvent>,
    }

    // Events
    struct CreateEvent has drop, store {
        htlc_id: u64,
        initiator: address,
        recipient: address,
        amount: u64,
        hashlock: vector<u8>,
        timelock: u64,
    }

    struct CompleteEvent has drop, store {
        htlc_id: u64,
        secret: vector<u8>,
        recipient: address,
    }

    struct RefundEvent has drop, store {
        htlc_id: u64,
        initiator: address,
    }

    // Initialize the module
    public entry fun initialize<CoinType>(account: &signer) {
        let addr = signer::address_of(account);
        assert!(!exists<GlobalState<CoinType>>(addr), E_ALREADY_EXISTS);

        move_to(account, GlobalState<CoinType> {
            htlcs: table::new(),
            escrow_balance: coin::zero<CoinType>(),
            next_id: 1,
            create_events: account::new_event_handle<CreateEvent>(account),
            complete_events: account::new_event_handle<CompleteEvent>(account),
            refund_events: account::new_event_handle<RefundEvent>(account),
        });
    }

    // Create a new HTLC
    public entry fun create_htlc<CoinType>(
        initiator: &signer,
        module_addr: address,
        recipient: address,
        amount: u64,
        hashlock: vector<u8>,
        timelock: u64,
    ) acquires GlobalState {
        let initiator_addr = signer::address_of(initiator);
        let state = borrow_global_mut<GlobalState<CoinType>>(module_addr);
        
        // Validate inputs
        assert!(vector::length(&hashlock) == 32, E_INVALID_SECRET);
        assert!(timestamp::now_seconds() < timelock, E_EXPIRED);

        // Transfer coins to escrow
        let payment = coin::withdraw<CoinType>(initiator, amount);
        coin::merge(&mut state.escrow_balance, payment);

        // Create HTLC
        let htlc_id = state.next_id;
        state.next_id = state.next_id + 1;

        let htlc = HTLCState<CoinType> {
            initiator: initiator_addr,
            recipient,
            amount,
            hashlock,
            timelock,
            secret: vector::empty(),
            completed: false,
            refunded: false,
        };

        table::add(&mut state.htlcs, htlc_id, htlc);

        // Emit event
        event::emit_event(&mut state.create_events, CreateEvent {
            htlc_id,
            initiator: initiator_addr,
            recipient,
            amount,
            hashlock,
            timelock,
        });
    }

    // Complete HTLC with secret
    public entry fun complete_htlc<CoinType>(
        recipient: &signer,
        module_addr: address,
        htlc_id: u64,
        secret: vector<u8>,
    ) acquires GlobalState {
        let recipient_addr = signer::address_of(recipient);
        let state = borrow_global_mut<GlobalState<CoinType>>(module_addr);
        
        assert!(table::contains(&state.htlcs, htlc_id), E_NOT_FOUND);
        let htlc = table::borrow_mut(&mut state.htlcs, htlc_id);
        
        // Validate
        assert!(htlc.recipient == recipient_addr, E_NOT_PARTICIPANT);
        assert!(!htlc.completed && !htlc.refunded, E_ALREADY_COMPLETED);
        assert!(timestamp::now_seconds() < htlc.timelock, E_EXPIRED);
        
        // Verify secret
        let secret_hash = hash::sha2_256(secret);
        assert!(secret_hash == htlc.hashlock, E_INVALID_SECRET);

        // Mark as completed and store secret
        htlc.completed = true;
        htlc.secret = secret;

        // Transfer funds
        let payment = coin::extract(&mut state.escrow_balance, htlc.amount);
        coin::deposit(recipient_addr, payment);

        // Emit event
        event::emit_event(&mut state.complete_events, CompleteEvent {
            htlc_id,
            secret,
            recipient: recipient_addr,
        });
    }

    // Refund expired HTLC
    public entry fun refund_htlc<CoinType>(
        initiator: &signer,
        module_addr: address,
        htlc_id: u64,
    ) acquires GlobalState {
        let initiator_addr = signer::address_of(initiator);
        let state = borrow_global_mut<GlobalState<CoinType>>(module_addr);
        
        assert!(table::contains(&state.htlcs, htlc_id), E_NOT_FOUND);
        let htlc = table::borrow_mut(&mut state.htlcs, htlc_id);
        
        // Validate
        assert!(htlc.initiator == initiator_addr, E_NOT_PARTICIPANT);
        assert!(!htlc.completed && !htlc.refunded, E_ALREADY_COMPLETED);
        assert!(timestamp::now_seconds() >= htlc.timelock, E_NOT_EXPIRED);

        // Mark as refunded
        htlc.refunded = true;

        // Transfer funds back
        let payment = coin::extract(&mut state.escrow_balance, htlc.amount);
        coin::deposit(initiator_addr, payment);

        // Emit event
        event::emit_event(&mut state.refund_events, RefundEvent {
            htlc_id,
            initiator: initiator_addr,
        });
    }

    // View functions
    #[view]
    public fun get_htlc<CoinType>(
        module_addr: address,
        htlc_id: u64
    ): (address, address, u64, vector<u8>, u64, bool, bool) acquires GlobalState {
        let state = borrow_global<GlobalState<CoinType>>(module_addr);
        assert!(table::contains(&state.htlcs, htlc_id), E_NOT_FOUND);
        
        let htlc = table::borrow(&state.htlcs, htlc_id);
        (
            htlc.initiator,
            htlc.recipient,
            htlc.amount,
            htlc.hashlock,
            htlc.timelock,
            htlc.completed,
            htlc.refunded
        )
    }

    #[view]
    public fun get_next_id<CoinType>(module_addr: address): u64 acquires GlobalState {
        borrow_global<GlobalState<CoinType>>(module_addr).next_id
    }

    #[view]
    public fun htlc_exists<CoinType>(module_addr: address, htlc_id: u64): bool acquires GlobalState {
        let state = borrow_global<GlobalState<CoinType>>(module_addr);
        table::contains(&state.htlcs, htlc_id)
    }
}