# 1inch Fusion+ Cosmos Integration - Deployment Summary

## Deployed Contracts on Neutron Testnet (pion-1)

### 1. Atomic Swap Contract
- **Address**: `neutron1tnetwd64jle2xncgkcpuf38sp9xhud7sku6tezjvvwdhvsfv6j3qeqkd53`
- **Code ID**: 12310
- **Purpose**: Handles HTLC-based atomic swaps on Cosmos

### 2. Cross-Chain Bridge Contract
- **Address**: `neutron1fw9wc9uyf0maluja7ftu25amx9w3yx6lqknvec5gejvz0974nrfq3zqcwz`
- **Code ID**: 12311
- **Purpose**: Manages IBC-based cross-chain orders
- **Configured for**: Ethereum Sepolia (Chain ID: 11155111)

### 3. Resolver Contract
- **Address**: `neutron1haev26g5d2es97kr8lup59aykf9raeu59w8nhtzr2t4fju0702qstcr42v`
- **Code ID**: 12313
- **Purpose**: Implements resolver pattern for trustless cross-chain coordination

## Configuration
- Protocol Fee: 0.5% (50 basis points)
- Timelock Range: 1-24 hours
- IBC Timeout: 10 minutes
- Minimum Safety Deposit: 1 NTRN

## Deployer Account
- Address: `neutron1njzwck6re79wy3z0ydrt32f57ddhuk0mngpk0r`
- Remaining Balance: ~51.74 NTRN

## Next Steps

### 1. Deploy EVM Contracts on Sepolia
You need to deploy the corresponding contracts on Ethereum Sepolia:
- EVM Resolver contract
- HTLC contract (if not using existing)

### 2. Configure Relayer Service
Set up the relayer to monitor both chains:
```typescript
const config = {
  cosmos: {
    rpc: "https://rpc-falcron.pion-1.ntrn.tech",
    contracts: {
      atomicSwap: "neutron1tnetwd64jle2xncgkcpuf38sp9xhud7sku6tezjvvwdhvsfv6j3qeqkd53",
      bridge: "neutron1fw9wc9uyf0maluja7ftu25amx9w3yx6lqknvec5gejvz0974nrfq3zqcwz",
      resolver: "neutron1haev26g5d2es97kr8lup59aykf9raeu59w8nhtzr2t4fju0702qstcr42v"
    }
  },
  evm: {
    rpc: "https://sepolia.infura.io/v3/YOUR_KEY",
    contracts: {
      resolver: "0x...", // Deploy this
    }
  }
}
```

### 3. Test Cross-Chain Swaps
- Cosmos → Sepolia: Create order on Cosmos resolver
- Sepolia → Cosmos: Create order on EVM resolver

## Transaction Hashes
- Atomic Swap deployment: Check explorer
- Bridge deployment: Check explorer
- Resolver deployment: `363A0C0A8D12F8F1294A3440704DD5445BD4F86179782B83BA0A076576C3C981`

## Explorer Links
- [Neutron Testnet Explorer](https://testnet.mintscan.io/neutron-testnet)
- [Contract Verification](https://neutron.celat.one/pion-1/contracts)

## Important Notes
1. These are testnet deployments - do not use for mainnet
2. IBC channel configuration may need updates based on actual channels
3. Ensure sufficient gas for cross-chain operations
4. Monitor relayer logs for troubleshooting