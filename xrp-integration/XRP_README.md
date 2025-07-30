# XRP Ledger Integration for 1inch Fusion+

This integration enables atomic swaps between XRP Ledger and Ethereum-compatible chains using Hash Time-Locked Contracts (HTLCs).

## Features

- ✅ Native XRP Ledger escrow functionality for HTLCs
- ✅ Bidirectional swaps (XRP ↔ ETH/Sepolia)
- ✅ TypeScript SDK for easy integration
- ✅ Automated relayer service
- ✅ Web UI for manual swaps
- ✅ Testnet deployment ready
- 🔄 Partial fills support (coming soon)

## Architecture

### Core Components

1. **XRP HTLC Implementation** (`src/xrp-htlc.ts`)
   - Uses XRP Ledger's native escrow feature
   - PREIMAGE-SHA-256 crypto conditions
   - Atomic swap primitives

2. **Fusion Client SDK** (`src/xrp-fusion-client.ts`)
   - High-level API for cross-chain swaps
   - Wallet management
   - Swap orchestration

3. **Relayer Service** (`src/xrp-relayer.ts`)
   - Monitors both chains for HTLC events
   - Automatically creates corresponding HTLCs
   - Facilitates trustless swaps

4. **Web UI** (`ui/index.html`)
   - User-friendly interface
   - Manual swap execution
   - Transaction monitoring

## Setup

### Prerequisites

- Node.js 16+
- XRP testnet account with funds
- Ethereum/Sepolia account with ETH

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```env
# XRP Configuration
XRP_SEED=your_xrp_seed_here

# EVM Configuration (Sepolia)
EVM_PRIVATE_KEY=your_ethereum_private_key
EVM_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your-api-key

# Optional: Custom XRP RPC
XRP_RPC_URL=wss://testnet.xrpl-labs.com
```

### Getting Testnet XRP

Visit the [XRP Testnet Faucet](https://xrpl.org/xrp-testnet-faucet.html) and request funds for your address.

## Usage

### Deploy to Testnet

```bash
npm run deploy:testnet
```

This will:
- Initialize your XRP wallet
- Check balance
- Create a test HTLC
- Save deployment info

### Run Cross-Chain Tests

#### XRP to Ethereum
```bash
npm run test:xrp-to-eth
```

#### Ethereum to XRP
```bash
npm run test:eth-to-xrp
```

### Start Relayer Service

```bash
npm run start:relayer
```

The relayer will:
- Monitor XRP escrows
- Monitor Ethereum HTLC events
- Automatically create corresponding HTLCs

### Launch Web UI

```bash
npm run serve:ui
```

Then open http://localhost:3000 in your browser.

## How It Works

### Atomic Swap Flow

1. **Initiation**
   - Alice generates a secret and its SHA-256 hashlock
   - Alice creates HTLC on source chain (e.g., XRP)
   - Locks funds with hashlock and timelock

2. **Counter-party Response**
   - Bob sees Alice's HTLC
   - Bob creates corresponding HTLC on target chain (e.g., Ethereum)
   - Uses same hashlock but shorter timelock

3. **Claim Phase**
   - Alice claims Bob's HTLC by revealing the secret
   - Bob sees the revealed secret on-chain
   - Bob claims Alice's HTLC using the same secret

4. **Refund (if swap fails)**
   - If not claimed before timelock expires
   - Original sender can refund their locked funds

### XRP Escrow Details

XRP Ledger's native escrow feature supports:
- Conditional release (crypto-conditions)
- Time-based expiration
- PREIMAGE-SHA-256 conditions for HTLCs

Example escrow creation:
```javascript
const escrowTx = {
    TransactionType: 'EscrowCreate',
    Account: sender,
    Destination: receiver,
    Amount: xrpToDrops(amount),
    Condition: cryptoCondition,
    CancelAfter: rippleTimelock
};
```

## API Reference

### XRPFusionClient

```typescript
// Initialize client
const client = new XRPFusionClient('wss://testnet.xrpl-labs.com');
await client.init(seed);

// Create HTLC
const result = await client.createHTLC({
    receiver: 'rAddress...',
    amount: '10', // XRP
    hashlock: Buffer,
    timelock: number // Ripple time
});

// Claim HTLC
await client.claimHTLC(escrowOwner, escrowSequence, secret);

// Refund expired HTLC
await client.refundHTLC(escrowOwner, escrowSequence);
```

### Time Conversion

XRP uses Ripple time (seconds since 2000-01-01):
```javascript
const rippleEpoch = 946684800;
const rippleTime = Math.floor(Date.now() / 1000) - rippleEpoch;
```

## Security Considerations

1. **Timelock Delta**: Ensure sufficient time difference between chains
2. **Secret Generation**: Use cryptographically secure random generation
3. **Network Monitoring**: Watch for chain reorganizations
4. **Gas/Fee Management**: Ensure sufficient funds for transactions

## Troubleshooting

### Connection Issues
- Try alternative XRP servers:
  - `wss://s.altnet.rippletest.net:51233`
  - `wss://testnet.xrpl-labs.com`

### Transaction Failures
- Check account balance
- Verify correct time format (Ripple vs Unix)
- Ensure proper sequence numbers

### HTLC Issues
- Verify hashlock format (32 bytes)
- Check crypto-condition encoding
- Confirm timelock hasn't expired

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

MIT