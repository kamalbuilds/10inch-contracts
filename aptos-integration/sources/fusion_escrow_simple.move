module fusion_swap::fusion_escrow_simple {
    use std::signer;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::timestamp;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::account;
    use aptos_std::table::{Self, Table};

    // Error codes
    const E_NOT_OWNER: u64 = 100;
    const E_EXPIRED: u64 = 101;
    const E_NOT_EXPIRED: u64 = 102;
    const E_ALREADY_CLAIMED: u64 = 103;
    const E_INVALID_SECRET: u64 = 104;
    const E_NOT_RELAYER: u64 = 105;
    const E_NOT_FOUND: u64 = 106;

    /// Escrow entry for cross-chain swaps
    struct EscrowEntry<phantom CoinType> has store {
        escrow_id: u64,
        owner: address,
        relayer: address,
        amount: Coin<CoinType>,
        secret_hash: vector<u8>,
        expiry: u64,
        claimed: bool,
        dst_chain: u8,
        dst_recipient: vector<u8>,
    }

    /// Escrow hub that manages all escrows
    struct EscrowHub<phantom CoinType> has key {
        escrows: Table<u64, EscrowEntry<CoinType>>,
        next_escrow_id: u64,
        
        // Events
        escrow_created_events: EventHandle<EscrowCreatedEvent>,
        escrow_claimed_events: EventHandle<EscrowClaimedEvent>,
        escrow_refunded_events: EventHandle<EscrowRefundedEvent>,
    }

    // Events
    struct EscrowCreatedEvent has drop, store {
        escrow_id: u64,
        owner: address,
        relayer: address,
        amount: u64,
        secret_hash: vector<u8>,
    }

    struct EscrowClaimedEvent has drop, store {
        escrow_id: u64,
        relayer: address,
        secret: vector<u8>,
    }

    struct EscrowRefundedEvent has drop, store {
        escrow_id: u64,
        owner: address,
    }

    /// Initialize escrow hub
    public entry fun initialize<CoinType>(hub: &signer) {
        let hub_addr = signer::address_of(hub);
        assert!(!exists<EscrowHub<CoinType>>(hub_addr), E_ALREADY_CLAIMED);

        move_to(hub, EscrowHub<CoinType> {
            escrows: table::new(),
            next_escrow_id: 1,
            escrow_created_events: account::new_event_handle<EscrowCreatedEvent>(hub),
            escrow_claimed_events: account::new_event_handle<EscrowClaimedEvent>(hub),
            escrow_refunded_events: account::new_event_handle<EscrowRefundedEvent>(hub),
        });
    }

    /// Create a new escrow
    public entry fun create_escrow<CoinType>(
        owner: &signer,
        hub_addr: address,
        amount: u64,
        relayer: address,
        secret_hash: vector<u8>,
        expiry: u64,
        dst_chain: u8,
        dst_recipient: vector<u8>,
    ) acquires EscrowHub {
        let owner_addr = signer::address_of(owner);
        let hub = borrow_global_mut<EscrowHub<CoinType>>(hub_addr);
        
        let escrow_id = hub.next_escrow_id;
        hub.next_escrow_id = escrow_id + 1;

        // Withdraw coins from owner
        let coins = coin::withdraw<CoinType>(owner, amount);

        // Create escrow entry
        let escrow = EscrowEntry<CoinType> {
            escrow_id,
            owner: owner_addr,
            relayer,
            amount: coins,
            secret_hash,
            expiry,
            claimed: false,
            dst_chain,
            dst_recipient,
        };

        table::add(&mut hub.escrows, escrow_id, escrow);

        event::emit_event(&mut hub.escrow_created_events, EscrowCreatedEvent {
            escrow_id,
            owner: owner_addr,
            relayer,
            amount,
            secret_hash,
        });
    }

    /// Relayer claims escrow with valid secret
    public entry fun claim_with_secret<CoinType>(
        relayer: &signer,
        hub_addr: address,
        escrow_id: u64,
        secret: vector<u8>,
    ) acquires EscrowHub {
        let relayer_addr = signer::address_of(relayer);
        let hub = borrow_global_mut<EscrowHub<CoinType>>(hub_addr);
        
        assert!(table::contains(&hub.escrows, escrow_id), E_NOT_FOUND);
        let escrow = table::borrow_mut(&mut hub.escrows, escrow_id);
        
        // Verify conditions
        assert!(escrow.relayer == relayer_addr, E_NOT_RELAYER);
        assert!(!escrow.claimed, E_ALREADY_CLAIMED);
        assert!(timestamp::now_seconds() < escrow.expiry, E_EXPIRED);
        
        // Verify secret
        let secret_hash = aptos_std::hash::sha2_256(secret);
        assert!(secret_hash == escrow.secret_hash, E_INVALID_SECRET);
        
        // Mark as claimed
        escrow.claimed = true;
        
        // Transfer coins to relayer
        let coins = coin::extract_all(&mut escrow.amount);
        coin::deposit(relayer_addr, coins);

        event::emit_event(&mut hub.escrow_claimed_events, EscrowClaimedEvent {
            escrow_id,
            relayer: relayer_addr,
            secret,
        });
    }

    /// Owner reclaims funds after expiry
    public entry fun reclaim_expired<CoinType>(
        owner: &signer,
        hub_addr: address,
        escrow_id: u64,
    ) acquires EscrowHub {
        let owner_addr = signer::address_of(owner);
        let hub = borrow_global_mut<EscrowHub<CoinType>>(hub_addr);
        
        assert!(table::contains(&hub.escrows, escrow_id), E_NOT_FOUND);
        let escrow = table::borrow_mut(&mut hub.escrows, escrow_id);
        
        // Verify conditions
        assert!(escrow.owner == owner_addr, E_NOT_OWNER);
        assert!(timestamp::now_seconds() >= escrow.expiry, E_NOT_EXPIRED);
        assert!(!escrow.claimed, E_ALREADY_CLAIMED);
        
        // Mark as claimed
        escrow.claimed = true;
        
        // Transfer coins back to owner
        let coins = coin::extract_all(&mut escrow.amount);
        coin::deposit(owner_addr, coins);

        event::emit_event(&mut hub.escrow_refunded_events, EscrowRefundedEvent {
            escrow_id,
            owner: owner_addr,
        });
    }

    /// Get escrow details
    public fun get_escrow_info<CoinType>(
        hub_addr: address, 
        escrow_id: u64
    ): (address, address, u64, vector<u8>, u64, bool) acquires EscrowHub {
        let hub = borrow_global<EscrowHub<CoinType>>(hub_addr);
        let escrow = table::borrow(&hub.escrows, escrow_id);
        
        (
            escrow.owner,
            escrow.relayer,
            coin::value(&escrow.amount),
            escrow.secret_hash,
            escrow.expiry,
            escrow.claimed
        )
    }

    /// Check if escrow is expired
    public fun is_expired<CoinType>(hub_addr: address, escrow_id: u64): bool acquires EscrowHub {
        let hub = borrow_global<EscrowHub<CoinType>>(hub_addr);
        let escrow = table::borrow(&hub.escrows, escrow_id);
        timestamp::now_seconds() >= escrow.expiry
    }
}