// Copyright (c) 1inch Network
// SPDX-License-Identifier: MIT

/// 1inch Fusion+ HTLC implementation for Sui
/// Implements Hash Time-Locked Contracts for cross-chain atomic swaps
module fusion_swap::fusion_htlc_v2 {
    use std::vector;
    use std::option::{Self, Option};
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;
    use sui::coin::{Self, Coin};
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::hash;
    use sui::balance::{Self, Balance};

    // ============ Error Codes ============
    const E_INVALID_SECRET: u64 = 1001;
    const E_EXPIRED: u64 = 1002;
    const E_NOT_EXPIRED: u64 = 1003;
    const E_NOT_PARTICIPANT: u64 = 1004;
    const E_ALREADY_WITHDRAWN: u64 = 1005;
    const E_ALREADY_REFUNDED: u64 = 1006;
    const E_INVALID_HASH_LENGTH: u64 = 1007;
    const E_INVALID_TIMELOCK: u64 = 1008;
    const E_INSUFFICIENT_AMOUNT: u64 = 1009;

    // ============ Constants ============
    const HASH_LENGTH: u64 = 32; // SHA-256 hash length
    const MIN_TIMELOCK_DURATION: u64 = 3600000; // 1 hour in ms
    const MAX_TIMELOCK_DURATION: u64 = 2592000000; // 30 days in ms

    // ============ Structs ============
    
    /// HTLC object - represents a hash time-locked contract
    struct HTLC<phantom T> has key, store {
        id: UID,
        sender: address,
        receiver: address,
        balance: Balance<T>,
        hashlock: vector<u8>,
        timelock: u64,
        secret: Option<vector<u8>>,
        withdrawn: bool,
        refunded: bool,
        created_at: u64,
    }

    /// Safety deposit for resolvers
    struct SafetyDeposit<phantom T> has key, store {
        id: UID,
        htlc_id: ID,
        resolver: address,
        balance: Balance<T>,
        created_at: u64,
    }

    // ============ Events ============
    
    struct HTLCCreated has copy, drop {
        htlc_id: ID,
        sender: address,
        receiver: address,
        amount: u64,
        hashlock: vector<u8>,
        timelock: u64,
        created_at: u64,
    }

    struct HTLCWithdrawn has copy, drop {
        htlc_id: ID,
        secret: vector<u8>,
        withdrawn_by: address,
        withdrawn_at: u64,
    }

    struct HTLCRefunded has copy, drop {
        htlc_id: ID,
        refunded_to: address,
        refunded_at: u64,
    }

    struct SafetyDepositCreated has copy, drop {
        deposit_id: ID,
        htlc_id: ID,
        resolver: address,
        amount: u64,
        created_at: u64,
    }

    // ============ Core Functions ============

    /// Create a new HTLC
    public fun create_htlc<T>(
        payment: Coin<T>,
        receiver: address,
        hashlock: vector<u8>,
        timelock: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): ID {
        let sender = tx_context::sender(ctx);
        let amount = coin::value(&payment);
        let current_time = clock::timestamp_ms(clock);
        
        // Validate inputs
        assert!(vector::length(&hashlock) == HASH_LENGTH, E_INVALID_HASH_LENGTH);
        assert!(amount > 0, E_INSUFFICIENT_AMOUNT);
        assert!(timelock > current_time + MIN_TIMELOCK_DURATION, E_INVALID_TIMELOCK);
        assert!(timelock <= current_time + MAX_TIMELOCK_DURATION, E_INVALID_TIMELOCK);

        let htlc_uid = object::new(ctx);
        let htlc_id = object::uid_to_inner(&htlc_uid);

        // Create HTLC object
        let htlc = HTLC<T> {
            id: htlc_uid,
            sender,
            receiver,
            balance: coin::into_balance(payment),
            hashlock,
            timelock,
            secret: option::none(),
            withdrawn: false,
            refunded: false,
            created_at: current_time,
        };

        // Emit event
        event::emit(HTLCCreated {
            htlc_id,
            sender,
            receiver,
            amount,
            hashlock,
            timelock,
            created_at: current_time,
        });

        // Share the HTLC object so both parties can interact
        transfer::share_object(htlc);
        
        htlc_id
    }

    /// Withdraw funds by providing the correct secret
    public fun withdraw<T>(
        htlc: &mut HTLC<T>,
        secret: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext
    ): Coin<T> {
        let withdrawer = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);
        
        // Validate state
        assert!(!htlc.withdrawn, E_ALREADY_WITHDRAWN);
        assert!(!htlc.refunded, E_ALREADY_REFUNDED);
        assert!(current_time < htlc.timelock, E_EXPIRED);
        assert!(withdrawer == htlc.receiver, E_NOT_PARTICIPANT);
        
        // Verify secret
        let secret_hash = hash::keccak256(&secret);
        assert!(secret_hash == htlc.hashlock, E_INVALID_SECRET);

        // Update state
        htlc.withdrawn = true;
        htlc.secret = option::some(secret);

        // Transfer funds
        let amount = balance::value(&htlc.balance);
        let payment = coin::take(&mut htlc.balance, amount, ctx);

        // Emit event
        event::emit(HTLCWithdrawn {
            htlc_id: object::uid_to_inner(&htlc.id),
            secret,
            withdrawn_by: withdrawer,
            withdrawn_at: current_time,
        });

        payment
    }

    /// Refund funds after timeout
    public fun refund<T>(
        htlc: &mut HTLC<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ): Coin<T> {
        let refunder = tx_context::sender(ctx);
        let current_time = clock::timestamp_ms(clock);
        
        // Validate state
        assert!(!htlc.withdrawn, E_ALREADY_WITHDRAWN);
        assert!(!htlc.refunded, E_ALREADY_REFUNDED);
        assert!(current_time >= htlc.timelock, E_NOT_EXPIRED);
        assert!(refunder == htlc.sender, E_NOT_PARTICIPANT);

        // Update state
        htlc.refunded = true;

        // Transfer funds back
        let amount = balance::value(&htlc.balance);
        let payment = coin::take(&mut htlc.balance, amount, ctx);

        // Emit event
        event::emit(HTLCRefunded {
            htlc_id: object::uid_to_inner(&htlc.id),
            refunded_to: refunder,
            refunded_at: current_time,
        });

        payment
    }

    /// Create safety deposit for resolver
    public fun create_safety_deposit<T>(
        htlc_id: ID,
        deposit: Coin<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ): ID {
        let resolver = tx_context::sender(ctx);
        let amount = coin::value(&deposit);
        let current_time = clock::timestamp_ms(clock);

        let deposit_uid = object::new(ctx);
        let deposit_id = object::uid_to_inner(&deposit_uid);

        let safety_deposit = SafetyDeposit<T> {
            id: deposit_uid,
            htlc_id,
            resolver,
            balance: coin::into_balance(deposit),
            created_at: current_time,
        };

        event::emit(SafetyDepositCreated {
            deposit_id,
            htlc_id,
            resolver,
            amount,
            created_at: current_time,
        });

        transfer::share_object(safety_deposit);
        
        deposit_id
    }

    /// Claim safety deposit (when resolver completes swap)
    public fun claim_safety_deposit<T>(
        deposit: SafetyDeposit<T>,
        ctx: &mut TxContext
    ): Coin<T> {
        let claimer = tx_context::sender(ctx);
        assert!(claimer == deposit.resolver, E_NOT_PARTICIPANT);

        let SafetyDeposit { 
            id, 
            htlc_id: _,
            resolver: _,
            balance,
            created_at: _ 
        } = deposit;

        object::delete(id);
        coin::from_balance(balance, ctx)
    }

    // ============ View Functions ============

    /// Get HTLC details
    public fun get_htlc_info<T>(htlc: &HTLC<T>): (
        address,
        address,
        u64,
        vector<u8>,
        u64,
        bool,
        bool
    ) {
        (
            htlc.sender,
            htlc.receiver,
            balance::value(&htlc.balance),
            htlc.hashlock,
            htlc.timelock,
            htlc.withdrawn,
            htlc.refunded
        )
    }

    /// Check if HTLC can be withdrawn
    public fun can_withdraw<T>(htlc: &HTLC<T>, clock: &Clock): bool {
        !htlc.withdrawn && 
        !htlc.refunded && 
        clock::timestamp_ms(clock) < htlc.timelock
    }

    /// Check if HTLC can be refunded
    public fun can_refund<T>(htlc: &HTLC<T>, clock: &Clock): bool {
        !htlc.withdrawn && 
        !htlc.refunded && 
        clock::timestamp_ms(clock) >= htlc.timelock
    }

    /// Get revealed secret (if withdrawn)
    public fun get_secret<T>(htlc: &HTLC<T>): Option<vector<u8>> {
        htlc.secret
    }

    // ============ Test Functions ============

    #[test_only]
    use sui::test_scenario;
    #[test_only]
    use sui::coin::mint_for_testing;
    #[test_only]
    use sui::sui::SUI;

    #[test]
    fun test_htlc_complete_flow() {
        let sender = @0x1;
        let receiver = @0x2;
        let scenario_val = test_scenario::begin(sender);
        let scenario = &mut scenario_val;

        // Create HTLC
        test_scenario::next_tx(scenario, sender);
        {
            let clock = clock::create_for_testing(test_scenario::ctx(scenario));
            let payment = mint_for_testing<SUI>(1000000, test_scenario::ctx(scenario));
            let secret = b"my_secret_32_bytes_long_string!!";
            let hashlock = hash::keccak256(&secret);
            let timelock = clock::timestamp_ms(&clock) + 7200000; // 2 hours

            create_htlc(
                payment,
                receiver,
                hashlock,
                timelock,
                &clock,
                test_scenario::ctx(scenario)
            );

            clock::destroy_for_testing(clock);
        };

        // Withdraw with secret
        test_scenario::next_tx(scenario, receiver);
        {
            let htlc = test_scenario::take_shared<HTLC<SUI>>(scenario);
            let clock = clock::create_for_testing(test_scenario::ctx(scenario));
            let secret = b"my_secret_32_bytes_long_string!!";

            let payment = withdraw(
                &mut htlc,
                secret,
                &clock,
                test_scenario::ctx(scenario)
            );

            assert!(coin::value(&payment) == 1000000, 0);
            coin::burn_for_testing(payment);
            
            test_scenario::return_shared(htlc);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }

    #[test]
    fun test_htlc_refund_flow() {
        let sender = @0x1;
        let receiver = @0x2;
        let scenario_val = test_scenario::begin(sender);
        let scenario = &mut scenario_val;

        // Create HTLC
        test_scenario::next_tx(scenario, sender);
        {
            let clock = clock::create_for_testing(test_scenario::ctx(scenario));
            let payment = mint_for_testing<SUI>(1000000, test_scenario::ctx(scenario));
            let secret = b"my_secret_32_bytes_long_string!!";
            let hashlock = hash::keccak256(&secret);
            let timelock = clock::timestamp_ms(&clock) + 3600000; // 1 hour

            create_htlc(
                payment,
                receiver,
                hashlock,
                timelock,
                &clock,
                test_scenario::ctx(scenario)
            );

            clock::destroy_for_testing(clock);
        };

        // Fast forward time and refund
        test_scenario::next_tx(scenario, sender);
        {
            let htlc = test_scenario::take_shared<HTLC<SUI>>(scenario);
            let clock = clock::create_for_testing(test_scenario::ctx(scenario));
            clock::increment_for_testing(&mut clock, 7200000); // 2 hours later

            let payment = refund(
                &mut htlc,
                &clock,
                test_scenario::ctx(scenario)
            );

            assert!(coin::value(&payment) == 1000000, 0);
            coin::burn_for_testing(payment);
            
            test_scenario::return_shared(htlc);
            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario_val);
    }
}