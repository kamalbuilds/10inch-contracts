# Osmosis Testnet Setup Guide

This guide will help you set up and test the 1inch Fusion+ Cosmos integration on Osmosis testnet.

## Why Osmosis?

- **Active testnet** with reliable infrastructure
- **CosmWasm enabled** for smart contract deployment
- **Good faucet availability** for test tokens
- **Strong IBC support** for cross-chain functionality
- **Active developer community** for support

## Prerequisites

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build contracts**:
   ```bash
   npm run compile-contracts
   npm run optimize-contracts
   ```

## Step 1: Create Wallets

### Cosmos/Osmosis Wallet

1. Install [Keplr wallet extension](https://www.keplr.app/)
2. Create a new wallet or import existing mnemonic
3. Switch to Osmosis Testnet (osmo-test-5)
4. Copy your mnemonic for the .env file

### EVM Wallet

1. Use MetaMask or any EVM wallet
2. Switch to Sepolia testnet
3. Export your private key for the .env file

## Step 2: Get Test Tokens

### Osmosis Testnet Tokens

1. Visit: https://faucet.testnet.osmosis.zone/
2. Enter your Osmosis address (starts with `osmo`)
3. Request test OSMO tokens

### Sepolia ETH

1. Visit: https://sepoliafaucet.com/
2. Enter your Ethereum address
3. Request test ETH

## Step 3: Configure Environment

1. Copy the example configuration:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your credentials:
   ```env
   # Cosmos Network Configuration (Osmosis Testnet)
   COSMOS_MNEMONIC="your twelve word mnemonic phrase here"
   COSMOS_RPC_ENDPOINT="https://rpc.testnet.osmosis.zone"
   COSMOS_CHAIN_ID="osmo-test-5"
   COSMOS_GAS_PRICE="0.025uosmo"

   # EVM Network Configuration
   EVM_PRIVATE_KEY="0x..."
   EVM_RPC_ENDPOINT="https://sepolia.infura.io/v3/YOUR_INFURA_KEY"
   
   # Relayer Configuration (can use same as above for testing)
   RELAYER_MNEMONIC="relayer mnemonic"
   RELAYER_PRIVATE_KEY="0x..."
   ```

## Step 4: Deploy Contracts

### Deploy to Osmosis

```bash
npm run deploy
```

This will:
- Upload and instantiate all three contracts
- Save deployment info to `deployment-info.json`
- Display contract addresses to add to your .env

### Deploy to Sepolia

1. Deploy the EVM resolver contract using Remix or Hardhat
2. Use the contract in `evm-contracts/CosmosResolver.sol`
3. Add the deployed address to your .env

## Step 5: Run the System

### Start the Relayer

```bash
npm run relayer
```

The relayer will:
- Monitor both Osmosis and Sepolia
- Process cross-chain orders
- Handle secret reveals

### Run End-to-End Test

```bash
npm run e2e-test
```

This tests:
- Osmosis → Sepolia atomic swap
- Sepolia → Osmosis atomic swap
- Full relayer functionality

## Common Issues

### "Insufficient gas" error
- Increase gas price in .env
- Current recommended: `0.025uosmo`

### "Account sequence mismatch"
- Wait a few seconds between transactions
- The chain needs time to update sequence

### Faucet not working
- Try the Discord faucet: https://discord.gg/osmosis
- Ask in #testnet-faucet channel

## Useful Links

- **Osmosis Testnet Explorer**: https://testnet.mintscan.io/osmosis-testnet
- **Osmosis Docs**: https://docs.osmosis.zone/
- **CosmWasm Docs**: https://docs.cosmwasm.com/
- **Sepolia Explorer**: https://sepolia.etherscan.io/

## Alternative Testnets

If Osmosis testnet is down, you can also try:

1. **Neutron Testnet (pion-1)**
   - RPC: `https://rpc-palvus.pion-1.ntrn.tech`
   - Prefix: `neutron`
   - Gas: `0.025untrn`

2. **Juno Testnet (uni-6)**
   - RPC: `https://rpc.uni.junonetwork.io`
   - Prefix: `juno`
   - Gas: `0.025ujunox`

Just update the configuration in your .env and constants.ts accordingly.