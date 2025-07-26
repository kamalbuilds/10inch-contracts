# Cardano Integration Guide for 1inch Fusion Plus

## Overview

This integration enables cross-chain atomic swaps between Cardano and EVM-compatible blockchains using Hash Time-Locked Contracts (HTLCs). The implementation uses Aiken for on-chain smart contracts and TypeScript for off-chain operations.

## Key Features

### 1. **HTLC Implementation in Aiken**
- Secure hash-locked and time-locked contract
- SHA256 for hash verification
- POSIX time-based expiration
- Built with Cardano's eUTxO model

### 2. **Partial Fill Support**
- Large orders can be split into smaller fills
- Configurable minimum partial amount
- Remaining funds stay locked in HTLC
- Enables better liquidity utilization

### 3. **Bidirectional Swaps**
- Cardano → EVM (ADA to ETH/MATIC/BNB)
- EVM → Cardano (ETH/MATIC/BNB to ADA)
- Automatic rate conversion (production would use oracles)

### 4. **TypeScript SDK**
- Easy-to-use client library
- Lucid Evolution for Cardano transactions
- Ethers.js for EVM integration
- Comprehensive type safety

## Architecture

### Smart Contract (Aiken)

```aiken
type HTLCDatum {
  secret_hash: ByteArray,
  recipient: VerificationKeyHash,
  sender: VerificationKeyHash,
  timeout: PosixTime,
  amount: Int,
  min_partial_amount: Int,
}

type HTLCRedeemer {
  ClaimWithSecret { secret: ByteArray, partial_amount: Option<Int> }
  ClaimTimeout
}
```

The validator enforces:
- Secret validation: `blake2b_256(secret) == datum.secret_hash`
- Time-based refunds after timeout
- Partial fills with minimum amounts

### Off-Chain Components

1. **CardanoFusionClient**: Main SDK for HTLC operations
2. **RelayerService**: Monitors and completes cross-chain swaps
3. **Deployment Scripts**: Easy testnet/mainnet deployment

## Getting Started

### Prerequisites

1. **Blockfrost API Key**
   - Sign up at [blockfrost.io](https://blockfrost.io)
   - Get a free API key for Preprod testnet

2. **Test ADA**
   - Get from [Cardano Testnet Faucet](https://docs.cardano.org/cardano-testnets/tools/faucet/)

3. **Node.js 16+**
   - Required for TypeScript SDK

### Installation

```bash
# Clone the repository
cd cardano-integration

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
```

### Deploy to Testnet

```bash
npm run deploy:testnet
```

This will:
- Initialize a Cardano wallet
- Deploy the HTLC validator
- Create a test HTLC
- Save deployment info

### Run Cross-Chain Tests

```bash
npm run test:crosschain
```

## Usage Examples

### Create HTLC on Cardano

```typescript
import { CardanoFusionClient } from './src/cardano-fusion-client';

const client = new CardanoFusionClient(
  blockfrostUrl,
  blockfrostApiKey,
  'Preprod'
);

await client.init(seedPhrase);

// Generate secret
const { secret, secretHash } = CardanoFusionClient.generateSecret();

// Create HTLC
const txHash = await client.createHTLC({
  secretHash,
  recipient: recipientAddress,
  sender: senderAddress,
  amount: CardanoFusionClient.adaToLovelace(5),
  timeout: Date.now() + 3600000, // 1 hour
  minPartialAmount: CardanoFusionClient.adaToLovelace(1),
});
```

### Claim with Secret

```typescript
// Full claim
await client.claimHTLC(utxo, secret);

// Partial claim
await client.claimPartialHTLC(utxo, secret, partialAmount);
```

### Cross-Chain Swap

```typescript
const relayer = new CardanoRelayerService(config);
await relayer.init();

// Cardano to Ethereum
const swapOrder = await relayer.createCrossChainSwap({
  sourceChain: 'cardano',
  targetChain: 'ethereum',
  amount: CardanoFusionClient.adaToLovelace(10),
  recipient: '0x...',
  timelockDuration: 3600,
});
```

## Production Considerations

### 1. **Oracle Integration**
- Use Chainlink or similar for ADA/ETH price feeds
- Implement slippage protection
- Add price impact calculations

### 2. **Security**
- Audit the Aiken smart contract
- Implement proper key management
- Add monitoring and alerts

### 3. **Performance**
- Use WebSocket connections for event monitoring
- Implement efficient UTXO management
- Add caching for frequently accessed data

### 4. **User Experience**
- Show swap progress in UI
- Provide clear error messages
- Add transaction history

## Comparison with Other Chains

| Feature | Cardano | Ethereum | TON | Sui |
|---------|---------|----------|-----|-----|
| Model | eUTxO | Account | Actor | Object |
| Language | Aiken | Solidity | FunC | Move |
| Fees | ~0.2 ADA | Variable | Low | Low |
| Finality | ~20s | ~15s | ~5s | ~3s |
| Partial Fills | Native | Contract | Contract | Native |

## Troubleshooting

### Common Issues

1. **"Insufficient ADA"**
   - Ensure wallet has at least 10 ADA for testing
   - Each HTLC requires ~2 ADA minimum

2. **"Transaction failed"**
   - Check Blockfrost API limits
   - Verify network sync status
   - Ensure correct addresses

3. **"Invalid datum"**
   - Verify all datum fields are properly formatted
   - Check timeout is in future
   - Ensure amounts are positive

### Debug Commands

```bash
# Check wallet balance
npm run check:balance

# Get HTLC state
npm run check:htlc -- <txHash>

# Monitor swaps
npm run monitor:swaps
```

## Next Steps

1. **Complete Aiken Compilation**
   - Install Aiken CLI
   - Compile validators
   - Generate Plutus blueprints

2. **Mainnet Deployment**
   - Audit smart contracts
   - Set up production infrastructure
   - Configure mainnet endpoints

3. **UI Integration**
   - Add Cardano to 1inch interface
   - Implement wallet connectors
   - Create swap flow UI

## Resources

- [Aiken Documentation](https://aiken-lang.org)
- [Lucid Evolution Docs](https://github.com/lucid-evolution/lucid-evolution)
- [Cardano Developer Portal](https://developers.cardano.org)
- [Blockfrost API Docs](https://docs.blockfrost.io)

## License

MIT