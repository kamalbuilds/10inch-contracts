/// 1inch Fusion+ Cross-Chain Atomic Swap Contract for Aptos
/// Production-ready HTLC implementation with enhanced security and gas optimization
module fusion_swap::atomic_swap {
    use std::signer;
    use std::vector;
    use std::bcs;
    use std::aptos_hash;
    use std::string::{Self, String};
    use aptos_framework::account::{Self, SignerCapability};
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::timestamp;
    use aptos_framework::type_info::{Self, TypeInfo};
    use aptos_framework::table::{Self, Table};
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::aptos_coin::AptosCoin;

    //===================================================================================
    // Error Codes
    //===================================================================================

    /// Protocol errors
    const E_NOT_INITIALIZED: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_SWAP_NOT_FOUND: u64 = 3;
    const E_SWAP_ALREADY_COMPLETED: u64 = 4;
    const E_SWAP_ALREADY_REFUNDED: u64 = 5;
    
    /// Validation errors
    const E_INVALID_AMOUNT: u64 = 10;
    const E_INVALID_SECRET_HASH: u64 = 11;
    const E_INVALID_SECRET: u64 = 12;
    const E_INVALID_TIMELOCK: u64 = 13;
    const E_INSUFFICIENT_BALANCE: u64 = 14;
    
    /// Authorization errors
    const E_NOT_AUTHORIZED: u64 = 20;
    const E_NOT_INITIATOR: u64 = 21;
    const E_NOT_RECIPIENT: u64 = 22;
    
    /// Timing errors
    const E_SWAP_EXPIRED: u64 = 30;
    const E_SWAP_NOT_EXPIRED: u64 = 31;
    const E_TIMELOCK_TOO_SHORT: u64 = 32;
    const E_TIMELOCK_TOO_LONG: u64 = 33;

    //===================================================================================
    // Constants
    //===================================================================================

    /// Minimum timelock duration (1 hour)
    const MIN_TIMELOCK_DURATION: u64 = 3600;
    
    /// Maximum timelock duration (24 hours)  
    const MAX_TIMELOCK_DURATION: u64 = 86400;
    
    /// Required secret hash length (32 bytes for SHA-256/Keccak-256)
    const SECRET_HASH_LENGTH: u64 = 32;
    
    /// Protocol fee in basis points (0.1% = 10 basis points)
    const PROTOCOL_FEE_BPS: u64 = 10;

    //===================================================================================
    // Structs & Resources
    //===================================================================================

    /// Represents the state of an atomic swap
    struct SwapState has copy, drop, store {
        /// Unique swap identifier
        id: u64,
        /// Address that initiated the swap
        initiator: address,
        /// Address that will receive the funds
        recipient: address,
        /// Amount being swapped
        amount: u64,
        /// Hash of the secret required to claim
        secret_hash: vector<u8>,
        /// Timestamp when the swap expires
        expiry_timestamp: u64,
        /// Current status of the swap
        status: u8, // 0: Active, 1: Completed, 2: Refunded
        /// Block timestamp when swap was created
        created_at: u64,
        /// Block timestamp when swap was completed/refunded (0 if active)
        completed_at: u64,
    }

    /// HTLC contract data for a specific coin type
    struct HTLCContract<phantom CoinType> has key {
        /// Mapping from swap ID to swap state
        swaps: Table<u64, SwapState>,
        /// Counter for generating unique swap IDs
        next_swap_id: u64,
        /// Capability for creating resource accounts (escrows)
        signer_cap: SignerCapability,
        /// Event handles
        swap_created_events: EventHandle<SwapCreatedEvent>,
        swap_completed_events: EventHandle<SwapCompletedEvent>,
        swap_refunded_events: EventHandle<SwapRefundedEvent>,
    }

    /// Resource holding actual funds for a swap
    struct SwapEscrow<phantom CoinType> has key {
        /// The swap ID this escrow belongs to
        swap_id: u64,
        /// Coins held in escrow
        coins: Coin<CoinType>,
        /// Capability to manage this escrow account
        signer_cap: SignerCapability,
    }

    //===================================================================================
    // Events
    //===================================================================================

    struct SwapCreatedEvent has drop, store {
        swap_id: u64,
        initiator: address,
        recipient: address,
        amount: u64,
        secret_hash: vector<u8>,
        expiry_timestamp: u64,
        coin_type: String,
    }

    struct SwapCompletedEvent has drop, store {
        swap_id: u64,
        initiator: address,
        recipient: address,
        amount: u64,
        secret: vector<u8>,
        completion_timestamp: u64,
    }

    struct SwapRefundedEvent has drop, store {
        swap_id: u64,
        initiator: address,
        recipient: address,
        amount: u64,
        refund_timestamp: u64,
    }

    //===================================================================================
    // Core Functions
    //===================================================================================

    /// Initialize the HTLC contract for a specific coin type
    public entry fun initialize<CoinType>(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        
        // Ensure not already initialized
        assert!(!exists<HTLCContract<CoinType>>(admin_addr), E_ALREADY_INITIALIZED);
        
        // Create resource account for managing escrows
        let seed = b"fusion_htlc_v1";
        vector::append(&mut seed, bcs::to_bytes(&type_info::type_of<CoinType>()));
        let (resource_signer, signer_cap) = account::create_resource_account(admin, seed);
        
        // Register the coin type for the resource account
        coin::register<CoinType>(&resource_signer);
        
        // Initialize the contract
        move_to(admin, HTLCContract<CoinType> {
            swaps: table::new(),
            next_swap_id: 1,
            signer_cap,
            swap_created_events: account::new_event_handle<SwapCreatedEvent>(admin),
            swap_completed_events: account::new_event_handle<SwapCompletedEvent>(admin),
            swap_refunded_events: account::new_event_handle<SwapRefundedEvent>(admin),
        });
    }

    /// Create a new atomic swap
    public entry fun create_swap<CoinType>(
        initiator: &signer,
        recipient: address,
        amount: u64,
        secret_hash: vector<u8>,
        timelock_duration: u64,
        admin_addr: address,
    ) acquires HTLCContract {
        // Validate inputs
        assert!(amount > 0, E_INVALID_AMOUNT);
        assert!(vector::length(&secret_hash) == SECRET_HASH_LENGTH, E_INVALID_SECRET_HASH);
        assert!(timelock_duration >= MIN_TIMELOCK_DURATION, E_TIMELOCK_TOO_SHORT);
        assert!(timelock_duration <= MAX_TIMELOCK_DURATION, E_TIMELOCK_TOO_LONG);
        assert!(recipient != signer::address_of(initiator), E_INVALID_AMOUNT);
        
        let initiator_addr = signer::address_of(initiator);
        
        // Ensure contract is initialized
        assert!(exists<HTLCContract<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let contract = borrow_global_mut<HTLCContract<CoinType>>(admin_addr);
        
        // Generate swap ID
        let swap_id = contract.next_swap_id;
        contract.next_swap_id = swap_id + 1;
        
        // Calculate expiry timestamp
        let current_time = timestamp::now_seconds();
        let expiry_timestamp = current_time + timelock_duration;
        
        // Create escrow account for this swap
        let escrow_seed = b"swap_escrow_";
        vector::append(&mut escrow_seed, bcs::to_bytes(&swap_id));
        let resource_signer = account::create_signer_with_capability(&contract.signer_cap);
        let (escrow_signer, escrow_signer_cap) = account::create_resource_account(&resource_signer, escrow_seed);
        let escrow_addr = signer::address_of(&escrow_signer);
        
        // Register coin type for escrow account
        coin::register<CoinType>(&escrow_signer);
        
        // Transfer funds from initiator to escrow
        let coins = coin::withdraw<CoinType>(initiator, amount);
        
        // Store coins in escrow resource
        move_to(&escrow_signer, SwapEscrow<CoinType> {
            swap_id,
            coins,
            signer_cap: escrow_signer_cap,
        });
        
        // Create swap state
        let swap_state = SwapState {
            id: swap_id,
            initiator: initiator_addr,
            recipient,
            amount,
            secret_hash,
            expiry_timestamp,
            status: 0, // Active
            created_at: current_time,
            completed_at: 0,
        };
        
        // Store swap
        table::add(&mut contract.swaps, swap_id, swap_state);
        
        // Emit event
        event::emit_event(&mut contract.swap_created_events, SwapCreatedEvent {
            swap_id,
            initiator: initiator_addr,
            recipient,
            amount,
            secret_hash,
            expiry_timestamp,
            coin_type: type_info::type_name<CoinType>(),
        });
    }

    /// Complete a swap by revealing the secret
    public entry fun complete_swap<CoinType>(
        recipient: &signer,
        swap_id: u64,
        secret: vector<u8>,
        admin_addr: address,
    ) acquires HTLCContract, SwapEscrow {
        let recipient_addr = signer::address_of(recipient);
        
        // Ensure contract is initialized
        assert!(exists<HTLCContract<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let contract = borrow_global_mut<HTLCContract<CoinType>>(admin_addr);
        
        // Ensure swap exists
        assert!(table::contains(&contract.swaps, swap_id), E_SWAP_NOT_FOUND);
        
        let swap_state = table::borrow_mut(&mut contract.swaps, swap_id);
        
        // Validate swap state
        assert!(swap_state.status == 0, E_SWAP_ALREADY_COMPLETED);
        assert!(swap_state.recipient == recipient_addr, E_NOT_RECIPIENT);
        assert!(timestamp::now_seconds() < swap_state.expiry_timestamp, E_SWAP_EXPIRED);
        
        // Verify secret
        let computed_hash = aptos_hash::keccak256(secret);
        assert!(computed_hash == swap_state.secret_hash, E_INVALID_SECRET);
        
        // Get escrow account
        let escrow_addr = get_escrow_address(admin_addr, swap_id);
        assert!(exists<SwapEscrow<CoinType>>(escrow_addr), E_SWAP_NOT_FOUND);
        
        // Transfer funds to recipient
        let SwapEscrow { swap_id: _, coins, signer_cap: _ } = move_from<SwapEscrow<CoinType>>(escrow_addr);
        coin::deposit(recipient_addr, coins);
        
        // Update swap state
        swap_state.status = 1; // Completed
        swap_state.completed_at = timestamp::now_seconds();
        
        // Emit event
        event::emit_event(&mut contract.swap_completed_events, SwapCompletedEvent {
            swap_id,
            initiator: swap_state.initiator,
            recipient: recipient_addr,
            amount: swap_state.amount,
            secret,
            completion_timestamp: swap_state.completed_at,
        });
    }

    /// Refund a swap after expiry
    public entry fun refund_swap<CoinType>(
        initiator: &signer,
        swap_id: u64,
        admin_addr: address,
    ) acquires HTLCContract, SwapEscrow {
        let initiator_addr = signer::address_of(initiator);
        
        // Ensure contract is initialized
        assert!(exists<HTLCContract<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        
        let contract = borrow_global_mut<HTLCContract<CoinType>>(admin_addr);
        
        // Ensure swap exists
        assert!(table::contains(&contract.swaps, swap_id), E_SWAP_NOT_FOUND);
        
        let swap_state = table::borrow_mut(&mut contract.swaps, swap_id);
        
        // Validate swap state
        assert!(swap_state.status == 0, E_SWAP_ALREADY_REFUNDED);
        assert!(swap_state.initiator == initiator_addr, E_NOT_INITIATOR);
        assert!(timestamp::now_seconds() >= swap_state.expiry_timestamp, E_SWAP_NOT_EXPIRED);
        
        // Get escrow account
        let escrow_addr = get_escrow_address(admin_addr, swap_id);
        assert!(exists<SwapEscrow<CoinType>>(escrow_addr), E_SWAP_NOT_FOUND);
        
        // Transfer funds back to initiator
        let SwapEscrow { swap_id: _, coins, signer_cap: _ } = move_from<SwapEscrow<CoinType>>(escrow_addr);
        coin::deposit(initiator_addr, coins);
        
        // Update swap state
        swap_state.status = 2; // Refunded
        swap_state.completed_at = timestamp::now_seconds();
        
        // Emit event
        event::emit_event(&mut contract.swap_refunded_events, SwapRefundedEvent {
            swap_id,
            initiator: initiator_addr,
            recipient: swap_state.recipient,
            amount: swap_state.amount,
            refund_timestamp: swap_state.completed_at,
        });
    }

    //===================================================================================
    // View Functions
    //===================================================================================

    /// Get swap details
    #[view]
    public fun get_swap<CoinType>(admin_addr: address, swap_id: u64): SwapState acquires HTLCContract {
        assert!(exists<HTLCContract<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let contract = borrow_global<HTLCContract<CoinType>>(admin_addr);
        assert!(table::contains(&contract.swaps, swap_id), E_SWAP_NOT_FOUND);
        *table::borrow(&contract.swaps, swap_id)
    }

    /// Check if swap exists
    #[view]
    public fun swap_exists<CoinType>(admin_addr: address, swap_id: u64): bool acquires HTLCContract {
        if (!exists<HTLCContract<CoinType>>(admin_addr)) {
            return false
        };
        let contract = borrow_global<HTLCContract<CoinType>>(admin_addr);
        table::contains(&contract.swaps, swap_id)
    }

    /// Check if swap is active (can be completed)
    #[view]
    public fun is_swap_active<CoinType>(admin_addr: address, swap_id: u64): bool acquires HTLCContract {
        if (!swap_exists<CoinType>(admin_addr, swap_id)) {
            return false
        };
        let swap_state = get_swap<CoinType>(admin_addr, swap_id);
        swap_state.status == 0 && timestamp::now_seconds() < swap_state.expiry_timestamp
    }

    /// Check if swap can be refunded
    #[view]
    public fun can_refund<CoinType>(admin_addr: address, swap_id: u64): bool acquires HTLCContract {
        if (!swap_exists<CoinType>(admin_addr, swap_id)) {
            return false
        };
        let swap_state = get_swap<CoinType>(admin_addr, swap_id);
        swap_state.status == 0 && timestamp::now_seconds() >= swap_state.expiry_timestamp
    }

    /// Get next swap ID
    #[view]
    public fun get_next_swap_id<CoinType>(admin_addr: address): u64 acquires HTLCContract {
        assert!(exists<HTLCContract<CoinType>>(admin_addr), E_NOT_INITIALIZED);
        let contract = borrow_global<HTLCContract<CoinType>>(admin_addr);
        contract.next_swap_id
    }

    //===================================================================================
    // Helper Functions
    //===================================================================================

    /// Generate escrow address for a swap ID
    fun get_escrow_address(admin_addr: address, swap_id: u64): address {
        let escrow_seed = b"swap_escrow_";
        vector::append(&mut escrow_seed, bcs::to_bytes(&swap_id));
        account::create_resource_address(&admin_addr, escrow_seed)
    }

    /// Verify secret against hash
    public fun verify_secret(secret: vector<u8>, secret_hash: vector<u8>): bool {
        let computed_hash = aptos_hash::keccak256(secret);
        computed_hash == secret_hash
    }

    //===================================================================================
    // Test Functions
    //===================================================================================

    #[test_only]
    use std::string;
    
    #[test_only]
    struct TestCoin {}

    #[test(admin = @0x123, initiator = @0x456, recipient = @0x789)]
    fun test_end_to_end_swap(admin: signer, initiator: signer, recipient: signer) 
        acquires HTLCContract, SwapEscrow {
        
        // Setup test environment
        timestamp::set_time_has_started_for_testing(&admin);
        timestamp::update_global_time_for_test_secs(1000);
        
        let admin_addr = signer::address_of(&admin);
        let initiator_addr = signer::address_of(&initiator);
        let recipient_addr = signer::address_of(&recipient);
        
        // Create test coin for initiator
        let (burn_cap, freeze_cap, mint_cap) = coin::initialize<TestCoin>(
            &admin,
            string::utf8(b"Test Coin"),
            string::utf8(b"TEST"),
            8,
            false,
        );
        
        coin::register<TestCoin>(&initiator);
        coin::register<TestCoin>(&recipient);
        
        let test_coins = coin::mint<TestCoin>(1000000, &mint_cap);
        coin::deposit(initiator_addr, test_coins);
        
        // Initialize HTLC contract
        initialize<TestCoin>(&admin);
        
        // Create secret and hash
        let secret = b"test_secret_12345678901234567890123";
        let secret_hash = aptos_hash::keccak256(secret);
        
        // Create swap
        create_swap<TestCoin>(&initiator, recipient_addr, 500000, secret_hash, 3600, admin_addr);
        
        // Verify swap was created
        let swap_state = get_swap<TestCoin>(admin_addr, 1);
        assert!(swap_state.amount == 500000, 1);
        assert!(swap_state.initiator == initiator_addr, 2);
        assert!(swap_state.recipient == recipient_addr, 3);
        assert!(is_swap_active<TestCoin>(admin_addr, 1), 4);
        
        // Complete swap
        complete_swap<TestCoin>(&recipient, 1, secret, admin_addr);
        
        // Verify completion
        let updated_swap = get_swap<TestCoin>(admin_addr, 1);
        assert!(updated_swap.status == 1, 5);
        assert!(coin::balance<TestCoin>(recipient_addr) == 500000, 6);
        
        // Cleanup
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_freeze_cap(freeze_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    #[test(admin = @0x123, initiator = @0x456, recipient = @0x789)]
    fun test_refund_after_expiry(admin: signer, initiator: signer, recipient: signer) 
        acquires HTLCContract, SwapEscrow {
        
        // Setup test environment
        timestamp::set_time_has_started_for_testing(&admin);
        timestamp::update_global_time_for_test_secs(1000);
        
        let admin_addr = signer::address_of(&admin);
        let initiator_addr = signer::address_of(&initiator);
        let recipient_addr = signer::address_of(&recipient);
        
        // Create test coin for initiator
        let (burn_cap, freeze_cap, mint_cap) = coin::initialize<TestCoin>(
            &admin,
            string::utf8(b"Test Coin"),
            string::utf8(b"TEST"),
            8,
            false,
        );
        
        coin::register<TestCoin>(&initiator);
        
        let test_coins = coin::mint<TestCoin>(1000000, &mint_cap);
        coin::deposit(initiator_addr, test_coins);
        
        // Initialize HTLC contract
        initialize<TestCoin>(&admin);
        
        // Create secret and hash
        let secret_hash = aptos_hash::keccak256(b"test_secret_12345678901234567890123");
        
        // Create swap with 1 hour timelock
        create_swap<TestCoin>(&initiator, recipient_addr, 500000, secret_hash, 3600, admin_addr);
        
        // Fast forward time past expiry
        timestamp::update_global_time_for_test_secs(5000); // 4000 seconds later
        
        // Verify swap can be refunded
        assert!(can_refund<TestCoin>(admin_addr, 1), 1);
        
        // Refund swap
        refund_swap<TestCoin>(&initiator, 1, admin_addr);
        
        // Verify refund
        let refunded_swap = get_swap<TestCoin>(admin_addr, 1);
        assert!(refunded_swap.status == 2, 2);
        assert!(coin::balance<TestCoin>(initiator_addr) == 1000000, 3);
        
        // Cleanup
        coin::destroy_burn_cap(burn_cap);
        coin::destroy_freeze_cap(freeze_cap);
        coin::destroy_mint_cap(mint_cap);
    }

    //===================================================================================
    // Error Getters (for external modules)
    //===================================================================================

    public fun get_invalid_secret_hash_error(): u64 {
        E_INVALID_SECRET_HASH
    }

    public fun get_not_initiator_error(): u64 {
        E_NOT_INITIATOR
    }
} 