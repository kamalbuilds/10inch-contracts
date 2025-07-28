# 1inch Fusion+ Cosmos Integration

A novel extension for 1inch Cross-chain Swap (Fusion+) that enables atomic swaps between Ethereum and Cosmos ecosystem chains using Hash Time Lock Contracts (HTLC) and Inter-Blockchain Communication (IBC).

## Overview

This integration extends 1inch Fusion+ to support the Cosmos ecosystem, enabling:
- **Bidirectional atomic swaps** between Ethereum and Cosmos
- **HTLC-based security** preserving hashlock and timelock functionality
- **IBC integration** for cross-chain communication
- **CosmWasm smart contracts** for atomic swap and bridge functionality
- **TypeScript SDK** for easy integration

## Architecture

```
cosmos-integration/
   contracts/                 # CosmWasm smart contracts
      atomic_swap/          # HTLC atomic swap contract
      cross_chain_bridge/   # Cross-chain bridge contract with IBC
        src/                      # TypeScript SDK
    CosmosAtomicSwap.ts     # Main SDK class
    types.ts             # TypeScript interfaces
    utils.ts             # Helper functions
    examples/            # Usage examples
    scripts/                  # Deployment and build scripts
```

## Features

### Atomic Swap Contract
- Create, complete, and refund atomic swaps
- SHA-256 hashlock validation
- Configurable timelock periods (1-24 hours)
- Protocol fee support
- Query swaps by initiator, recipient, or status

### Cross-Chain Bridge Contract
- Create bridge orders between Cosmos and EVM chains
- IBC packet handling for cross-chain transfers
- Multi-chain configuration support
- Fee calculation per target chain
- Order tracking and status management

### TypeScript SDK
- Easy-to-use client for interacting with contracts
- Secret generation and validation utilities
- Support for both atomic swaps and bridge orders
- Comprehensive querying capabilities

## Requirements

- Rust 1.70+ with `wasm32-unknown-unknown` target
- Node.js 16+
- Docker (for contract optimization)
- CosmJS dependencies

# Installation

1. Clone the repository:
```bash
cd cosmos-integration
```

2. Install dependencies:
```bash
npm install
```

3. Build contracts:
```bash
./scripts/build.sh
```

## 🚀 Quick Start Guide

### 1. Setup Environment

Copy `.env.example` to `.env` and fill in your configuration:

```bash
cp .env.example .env
```

Required configuration:
- `COSMOS_MNEMONIC`: Your Cosmos wallet mnemonic
- `EVM_PRIVATE_KEY`: Your EVM wallet private key
- `RELAYER_MNEMONIC`: Relayer's Cosmos wallet mnemonic
- `RELAYER_PRIVATE_KEY`: Relayer's EVM wallet private key

### 2. Deploy Contracts

Deploy all contracts to Cosmos testnet:

```bash
npm run deploy
```

This will deploy:
- Atomic Swap contract
- Cross-Chain Bridge contract
- Resolver contract

Update your `.env` file with the deployed contract addresses.

### 3. Deploy EVM Resolver

Deploy the EVM resolver contract to Sepolia or your preferred testnet using the provided Solidity contracts in `evm-contracts/`.

### 4. Run Relayer Service

Start the cross-chain relayer:

```bash
npm run relayer
```

The relayer monitors both chains and facilitates cross-chain swaps.

### 5. Test End-to-End

Run the complete end-to-end test:

```bash
npm run e2e-test
```

This will:
- Test Cosmos → EVM atomic swap
- Test EVM → Cosmos atomic swap
- Demonstrate relayer functionality

## =� Usage

### Initialize the SDK

```typescript
import { CosmosAtomicSwap } from '@1inch/cosmos-integration';
import { TESTNET_CONFIG } from '@1inch/cosmos-integration/constants';

const client = new CosmosAtomicSwap({
  ...TESTNET_CONFIG,
  atomicSwapContract: 'cosmos1...', // Your contract address
  bridgeContract: 'cosmos1...',     // Your bridge address
});

// Connect with mnemonic
await client.connect('your mnemonic phrase...');
```

### Create an Atomic Swap

```typescript
// Generate secret and hashlock
const secret = client.generateSecret();
const secretHash = client.generateHashlock(secret);

// Create swap
const result = await client.createSwap({
  recipient: 'cosmos1recipient...',
  secretHash,
  timelock: 7200, // 2 hours
  amount: {
    denom: 'uatom',
    amount: '1000000', // 1 ATOM
  },
});

console.log(`Swap created with TX: ${result.transactionHash}`);
```

### Complete a Swap

```typescript
const completeResult = await client.completeSwap({
  swapId: 'swap_1',
  secret: 'your_secret_here',
});
```

### Create a Cross-Chain Bridge Order

```typescript
const bridgeResult = await client.createBridgeOrder({
  targetChainId: 2, // Ethereum
  recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278d',
  secretHash,
  timelock: 3600, // 1 hour
  amount: {
    denom: 'uatom',
    amount: '5000000', // 5 ATOM
  },
});
```

### Query Functions

```typescript
// Query a specific swap
const swap = await client.querySwap('swap_1');

// Query swaps by initiator
const mySwaps = await client.querySwaps({
  initiator: 'cosmos1...',
  limit: 10,
});

// Query bridge order
const order = await client.queryBridgeOrder('bridge_order_1');

// Query chain configuration
const chainConfig = await client.queryChainConfig(2); // Ethereum
```

## Contract Deployment

1. Set up your deployment configuration in `scripts/deploy.ts`

2. Deploy contracts:
```bash
npm run deploy
```

The deployment script will:
- Upload contract code to the chain
- Instantiate both atomic swap and bridge contracts
- Configure initial chain settings
- Output contract addresses

## Testing

Run the test suite:
```bash
npm test
```

Run the demo:
```bash
npm run demo
```

## = Security Considerations

1. **Secret Management**: Never share or log swap secrets before completion
2. **Timelock Duration**: Set appropriate timelock based on expected completion time
3. **Fee Configuration**: Protocol fees are configurable by contract owner
4. **IBC Timeouts**: Ensure IBC timeout is less than swap timelock

## <	 Supported Chains

### Source Chain
- Cosmos Hub (ATOM)
- Any Cosmos SDK chain with CosmWasm enabled

### Target Chains (via Bridge)
- Ethereum (ETH)
- Binance Smart Chain (BSC)
- Polygon (MATIC)
- Arbitrum
- Optimism

## =� Protocol Fees

- Base protocol fee: 0.5% (50 basis points)
- Additional chain-specific fees:
  - Ethereum: +1.0%
  - BSC: +0.5%
  - Polygon: +0.25%

##  Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## =� License

This project is licensed under the MIT License - see the LICENSE file for details.

##  Resources

- [1inch Fusion+ Documentation](https://docs.1inch.io/fusion)
- [Cosmos SDK Documentation](https://docs.cosmos.network/)
- [CosmWasm Documentation](https://docs.cosmwasm.com/)
- [IBC Protocol](https://ibc.cosmos.network/)

## <� Hackathon Requirements Met

**Hashlock and timelock functionality preserved** in non-EVM implementation  
**Bidirectional swaps** between Ethereum and Cosmos  
**On-chain execution** ready for mainnet/testnet deployment  
**Partial fills** supported through contract design  
**UI-ready SDK** with comprehensive TypeScript interface  
**Relayer support** through IBC message handling

## =� Support

For questions and support, please open an issue in the GitHub repository.