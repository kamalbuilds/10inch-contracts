# 1inch Fusion+ XRP Integration

This integration enables cross-chain atomic swaps between XRP Ledger and Ethereum/EVM chains using the 1inch Fusion+ protocol.

## < Features

- **Native XRP Ledger Escrows**: Uses XRP's built-in escrow functionality for HTLCs
- **Bidirectional Swaps**: Support for both XRP ’ ETH and ETH ’ XRP swaps
- **Atomic Execution**: Guaranteed swap completion or full refund
- **No Smart Contract Deployment**: Leverages XRP's native features
- **Fast Settlement**: 3-5 second finality on XRP Ledger
- **Low Cost**: ~0.00001 XRP per transaction

## <× Architecture

### Components

1. **XRP HTLC (`xrp-htlc.ts`)**
   - Core implementation using XRP Ledger's escrow feature
   - PREIMAGE-SHA-256 crypto conditions for hash locks
   - Time-based expiration for automatic refunds

2. **XRP Fusion Client (`xrp-fusion-client.ts`)**
   - High-level SDK for cross-chain swaps
   - Wallet management and transaction handling
   - Compatible with 1inch Fusion+ architecture

3. **Relayer Service (`xrp-relayer.ts`)**
   - Monitors both XRP and EVM chains
   - Creates corresponding HTLCs
   - Extracts and relays secrets

4. **Web UI (`ui/index.html`)**
   - Simple interface for testing swaps
   - Wallet connection simulation
   - Real-time swap status

## =€ Quick Start

### Prerequisites

- Node.js 16+
- XRP testnet account with funds
- Sepolia ETH for testing

### Installation

```bash
npm install
```

### Configuration

1. Copy `.env.example` to `.env`
2. Add your XRP seed and EVM private key
3. Get testnet XRP from: https://xrpl.org/xrp-testnet-faucet.html

### Deploy to Testnet

```bash
npm run deploy:testnet
```

This will:
- Generate or use existing XRP wallet
- Test HTLC creation and claiming
- Save deployment info

### Run Cross-Chain Test

```bash
npm run test:crosschain
```

Tests both XRP ’ ETH and ETH ’ XRP swaps.

### Start Relayer Service

```bash
npm run start:relayer
```

Monitors both chains and facilitates atomic swaps.

### Launch UI

```bash
npm run serve:ui
```

Open http://localhost:3000 to access the swap interface.

## =Ö How It Works

### XRP ’ ETH Swap

1. User creates escrow on XRP Ledger with hashlock
2. Relayer detects escrow and creates HTLC on Ethereum
3. User claims ETH by revealing secret
4. Relayer uses secret to claim XRP

### ETH ’ XRP Swap

1. User creates HTLC on Ethereum with hashlock
2. Relayer detects HTLC and creates escrow on XRP
3. User claims XRP by revealing secret
4. Relayer uses secret to claim ETH

## =' API Reference

### XRPHTLC

```typescript
// Create HTLC
const result = await xrpHTLC.createHTLC({
  sender: "rAddress...",
  receiver: "rAddress...",
  amount: "10", // XRP
  hashlock: Buffer,
  timelock: 1234567890 // Unix timestamp
});

// Claim with secret
const claim = await xrpHTLC.redeemHTLC(
  escrowOwner,
  escrowSequence,
  secret
);

// Refund after expiry
const refund = await xrpHTLC.refundHTLC(
  escrowOwner,
  escrowSequence
);
```

### XRPFusionClient

```typescript
// Initialize
const client = new XRPFusionClient();
await client.init(seed);

// Create cross-chain swap
const swap = await client.initiateSwap({
  sourceChain: 'XRP',
  targetChain: 'ETH',
  sourceAmount: '10',
  targetAmount: '0.01',
  receiverAddress: '0x...'
});

// Complete swap
await client.completeSwap(
  swapId,
  escrowOwner,
  escrowSequence
);
```

## =Ê Partial Fills (TODO)

The XRP Ledger escrow system doesn't natively support partial fills. To implement this:

1. **Split Orders**: Create multiple smaller escrows
2. **Payment Channels**: Use XRP's payment channels for streaming payments
3. **Custom Logic**: Implement fill tracking off-chain

## = Security Considerations

- Always verify hashlocks match before revealing secrets
- Set appropriate timelocks (recommended: 1-2 hours)
- Monitor for transaction finality before proceeding
- Use secure random number generation for secrets

## >ê Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### Manual Testing
1. Deploy to testnet
2. Run cross-chain test
3. Monitor transactions on explorers:
   - XRP: https://testnet.xrpl.org
   - Sepolia: https://sepolia.etherscan.io

## =Ý License

MIT

## > Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open pull request

## =Ú Resources

- [XRP Ledger Docs](https://xrpl.org/docs)
- [Escrow Tutorial](https://xrpl.org/escrow.html)
- [Crypto Conditions](https://xrpl.org/crypto-conditions.html)
- [1inch Fusion+](https://docs.1inch.io/docs/fusion-swap/introduction)