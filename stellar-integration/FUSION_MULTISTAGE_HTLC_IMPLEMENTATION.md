# Fusion Multi-Stage HTLC Implementation for Stellar

## Contract Location

The v2 contract is located at: `contracts/fusion-htlc/src/lib.rs`

## Key Features Implemented

### 1. Multi-Stage Settlement Periods

The contract implements 6 distinct stages with automatic transitions based on timestamps:

```rust
pub enum HTLCStatus {
    Pending,              // Initial state - no operations allowed
    Finalized,           // After finality_time, ready for settlement
    TakerSettlement,     // Exclusive period for original taker
    PrivateSettlement,   // Whitelisted resolvers can settle
    PublicSettlement,    // Anyone can settle
    PrivateCancellation, // Sender or whitelisted can cancel
    PublicCancellation,  // Anyone can cancel
    Completed,           // Successfully withdrawn
    Cancelled,           // Cancelled and refunded
}
```

### 2. Configurable Stage Durations

Each HTLC can have custom stage durations:

```rust
pub struct StageDurations {
    pub finality_delay: u64,                    // Time until HTLC is finalized
    pub taker_exclusive_duration: u64,          // Taker-only period
    pub private_resolver_duration: u64,         // Whitelisted resolvers period
    pub public_resolver_duration: u64,          // Anyone can resolve period
    pub private_cancellation_duration: u64,     // Private cancellation period
}
```

### 3. Access Control by Stage

- **Pending**: No operations allowed
- **Taker Settlement**: Only the original taker can withdraw
- **Private Settlement**: Taker, whitelisted resolvers, or global resolvers
- **Public Settlement**: Anyone with the secret can withdraw
- **Private Cancellation**: Sender, whitelisted resolvers, or global resolvers
- **Public Cancellation**: Anyone can cancel

### 4. Resolver Management

- **Whitelisted Resolvers**: Per-HTLC resolver whitelist
- **Global Resolvers**: Admin-managed global resolver registry with priority levels
- **Resolver Fees**: Configurable fees with optional discounts

### 5. Enhanced Security

- Automatic stage transitions based on blockchain timestamps
- No manual stage updates required
- Clear separation of permissions per stage
- Resolver fee distribution on successful settlement

## Compilation

The contract has been successfully compiled:

```bash
cargo build --release --target wasm32-unknown-unknown
```

Generated WASM file: `target/wasm32-unknown-unknown/release/fusion_htlc_multistage.wasm` (21,854 bytes)

## Deployment and Testing

We've also created:
1. **Deployment Script**: `scripts/deploy-fusion-htlc.ts`
2. **Test Script**: `scripts/test-fusion-htlc.ts`

## Example Usage

```typescript
// Create HTLC with multi-stage timelocks
const stageDurations = {
    finality_delay: 60,              // 1 minute
    taker_exclusive_duration: 120,    // 2 minutes
    private_resolver_duration: 180,   // 3 minutes
    public_resolver_duration: 240,    // 4 minutes
    private_cancellation_duration: 300 // 5 minutes
};

await contract.create_fusion_htlc(
    sender,
    receiver,
    token,
    amount,
    hashlock,
    takerAddress,
    allowedResolvers,
    stageDurations,
    resolverFeeBps
);
```