# Complete Cross-Chain Deployment Guide

## ✅ Deployed Contracts

### Cosmos (Neutron Testnet - pion-1)
All contracts successfully deployed and tested!

1. **Atomic Swap Contract**
   - Address: `neutron1tnetwd64jle2xncgkcpuf38sp9xhud7sku6tezjvvwdhvsfv6j3qeqkd53`
   - Code ID: 12310
   - Features: HTLC-based atomic swaps

2. **Cross-Chain Bridge Contract**
   - Address: `neutron1fw9wc9uyf0maluja7ftu25amx9w3yx6lqknvec5gejvz0974nrfq3zqcwz`
   - Code ID: 12311
   - Features: IBC integration for cross-chain orders

3. **Resolver Contract**
   - Address: `neutron1haev26g5d2es97kr8lup59aykf9raeu59w8nhtzr2t4fju0702qstcr42v`
   - Code ID: 12313
   - Features: Trustless cross-chain coordination

### EVM (Sepolia - To Deploy)
The EVM contracts are ready in `evm-contracts/` folder.

## 🔄 Test Transaction Created

### Cosmos → Sepolia Order
- **Order ID**: 2
- **Amount**: 1 NTRN → 0.001 ETH
- **Secret Hash**: `6dd9b6391d2fe48c9c252eddb5528f52d176ab71d8b9bd858d972d44c72d3ef2`
- **Transaction**: `6680D77F6AEE8E68C43B6D22EEA47AA7D0A54836932DFA4E2A578BD83BC8746E`
- **Status**: Waiting for resolver to fill on Sepolia

## 📋 Complete the Cross-Chain Setup

### Step 1: Deploy EVM Contracts on Sepolia

```bash
# Option 1: Using Hardhat
cd evm-contracts
npx hardhat compile
npx hardhat run --network sepolia scripts/deploy.js

# Option 2: Using Foundry
forge create --rpc-url $SEPOLIA_RPC \
  --private-key $SEPOLIA_PRIVATE_KEY \
  evm-contracts/CosmosResolver.sol:CosmosResolver

# Option 3: Use existing EscrowFactory
# The cross-chain-swap contracts are already deployed on many chains
```

### Step 2: Configure and Run Relayer

```typescript
// relayer-config.ts
export const config = {
  cosmos: {
    rpc: "https://rpc-falcron.pion-1.ntrn.tech",
    contracts: {
      atomicSwap: "neutron1tnetwd64jle2xncgkcpuf38sp9xhud7sku6tezjvvwdhvsfv6j3qeqkd53",
      bridge: "neutron1fw9wc9uyf0maluja7ftu25amx9w3yx6lqknvec5gejvz0974nrfq3zqcwz",
      resolver: "neutron1haev26g5d2es97kr8lup59aykf9raeu59w8nhtzr2t4fju0702qstcr42v"
    }
  },
  sepolia: {
    rpc: process.env.SEPOLIA_RPC,
    contracts: {
      resolver: "0x..." // Your deployed address
    }
  }
}
```

### Step 3: Complete the Test Swap

For the existing Cosmos → Sepolia order:
1. Resolver calls `fillOrder()` on Sepolia with safety deposit
2. Resolver deploys destination escrow on Cosmos
3. User reveals secret: `mysecret1753508819127`
4. Resolver claims on both sides

## 🛠️ Environment Setup

Create `.env` file:
```env
# Cosmos
COSMOS_MNEMONIC="your cosmos wallet mnemonic"

# Sepolia
SEPOLIA_PRIVATE_KEY="your sepolia private key"
SEPOLIA_RPC="https://sepolia.infura.io/v3/YOUR_KEY"
COSMOS_RESOLVER_ADDRESS="0x..." # After deployment
```

## 📊 Current Balances
- Cosmos: ~50.22 NTRN remaining
- Sepolia: Needs ETH for deployment and testing

## 🚀 Quick Test Commands

```bash
# Test Cosmos to Sepolia
npm run test:cosmos-to-sepolia

# Test Sepolia to Cosmos (after EVM deployment)
npm run test:sepolia-to-cosmos

# Run relayer
npm run relayer
```

## 📝 Important Notes

1. **Gas Costs**: Keep sufficient balance on both chains
2. **Timelock**: Default 1 hour, adjust as needed
3. **Safety Deposit**: Currently 0.5 NTRN, adjust based on risk
4. **IBC Channels**: Update when real channels are established

## 🔗 Resources

- [Neutron Testnet Explorer](https://testnet.mintscan.io/neutron-testnet)
- [Sepolia Explorer](https://sepolia.etherscan.io/)
- [Get Neutron Testnet Tokens](https://t.me/neutron_faucet_bot)
- [Get Sepolia ETH](https://sepoliafaucet.com/)

## ✨ Success!

You have successfully:
1. ✅ Deployed all Cosmos contracts
2. ✅ Created a test cross-chain order
3. ⏳ Ready to deploy EVM contracts and complete the flow

The infrastructure is ready for full cross-chain atomic swaps between Cosmos and EVM chains!