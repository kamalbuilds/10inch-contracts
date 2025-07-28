# Neutron Testnet (pion-1) Setup Guide

## Quick Setup for Neutron Testnet

Neutron has **working faucets** via Telegram and Discord!

### 1. Get Test Tokens

**Option A - Telegram Faucet (Recommended)**:
1. Join: https://t.me/+SyhWrlnwfCw2NGM6
2. Type: `/request neutron1...` (your address)
3. Receive test NTRN immediately

**Option B - Discord Faucet**:
1. Join: https://discord.com/invite/bzPBzbDvWC
2. Go to #testnet-faucet channel
3. Request tokens with faucet command

### 2. Network Configuration

Update your `.env` file:

```env
# Neutron Testnet Configuration
COSMOS_MNEMONIC="your twelve word mnemonic phrase here"
COSMOS_RPC_ENDPOINT="https://rpc-palvus.pion-1.ntrn.tech"
COSMOS_CHAIN_ID="pion-1"
COSMOS_GAS_PRICE="0.025untrn"
```

### 3. Update Constants

Edit `src/constants.ts`:

```typescript
export const TESTNET_CONFIG: NetworkConfig = {
  rpcEndpoint: 'https://rpc-palvus.pion-1.ntrn.tech',
  chainId: 'pion-1',
  prefix: 'neutron',
  gasPrice: '0.025untrn',
};
```

### 4. Deploy and Test

```bash
# Deploy contracts
npm run deploy

# Run e2e test
npm run e2e-test
```

## Network Details

- **Chain ID**: pion-1
- **Token**: untrn
- **Prefix**: neutron (addresses start with `neutron1...`)
- **Explorer**: https://testnet.mintscan.io/neutron-testnet

## Alternative RPCs

If the main RPC is slow, try:
- https://rpc.pion-1.ntrn.tech
- https://neutron-testnet-rpc.polkachu.com

## Why Neutron?

- Built for cross-chain smart contracts
- CosmWasm native support
- Active testnet with working faucets
- Good for DeFi applications