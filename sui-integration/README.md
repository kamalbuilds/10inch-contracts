# 1inch Fusion+ Sui Integration

This directory contains the Sui blockchain integration for 1inch Fusion+ cross-chain swaps.

## 🚀 Deployed Contracts

### Sui Testnet
- **Package ID**: `0x0e486741e8ea783f433f3093659fc3dfc05bcee1726cfe7bc5a7718ff82436ad`
- **Modules**: 
  - `fusion_htlc_v2` - Hash Time-Locked Contract implementation
  - `fusion_cross_chain` - Cross-chain swap management
- **Explorer**: [View on Sui Explorer](https://suiexplorer.com/object/0x0e486741e8ea783f433f3093659fc3dfc05bcee1726cfe7bc5a7718ff82436ad?network=testnet)

### Ethereum Sepolia (Shared HTLC)
- **Contract**: `0x067423CA883d8D54995735aDc1FA23c17e5b62cc`
- **Type**: SimpleHTLC
- **Explorer**: [View on Etherscan](https://sepolia.etherscan.io/address/0x067423CA883d8D54995735aDc1FA23c17e5b62cc)
- **Documentation**: See [SHARED_HTLC_DEPLOYMENT.md](../SHARED_HTLC_DEPLOYMENT.md)

## 📋 Features

- **Atomic Swaps**: Trustless cross-chain swaps using HTLCs
- **No Bridges**: Direct swaps without intermediary bridges
- **Multi-Chain Support**: Integrates with 7 EVM chains
- **Keccak256 Validation**: Compatible with Ethereum's hash function
- **Time-Locked Security**: Configurable timelock (1 hour - 30 days)
- **Safety Deposits**: Optional resolver incentives

## 🛠️ Setup

### Prerequisites
- Node.js 18+
- Sui CLI
- TypeScript

### Installation
```bash
npm install
```

### Environment Variables
Create a `.env` file:
```bash
SUI_PRIVATE_KEY=your_sui_private_key
SEPOLIA_PRIVATE_KEY=your_ethereum_private_key  # Optional
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com
```

## 🧪 Testing

### Run All Tests
```bash
# Compile Move modules
sui move build

# Deploy to testnet (if not already deployed)
npm run deploy

# Run tests
npm test
```

### Individual Test Scripts

1. **Simple HTLC Test** (Sui only)
   ```bash
   npx ts-node test-sui-to-sepolia-simple.ts
   ```

2. **Sui → Sepolia Test**
   ```bash
   npx ts-node test-sui-to-sepolia.ts
   ```

3. **Sepolia → Sui Test**
   ```bash
   npx ts-node test-sepolia-to-sui.ts
   ```

4. **Real Contract Demo**
   ```bash
   npx ts-node test-sepolia-htlc-demo.ts
   ```

## 🔄 Cross-Chain Swap Flow

### Sui → Ethereum
1. User creates outbound order on Sui
2. Resolver accepts order and locks SUI
3. Resolver creates HTLC on Ethereum
4. User reveals secret on Ethereum
5. Resolver uses secret to claim SUI

### Ethereum → Sui
1. User creates HTLC on Ethereum
2. Resolver creates inbound order on Sui
3. Resolver locks SUI with matching hashlock
4. User reveals secret on Sui
5. Resolver uses secret to claim ETH

## 📁 Project Structure

```
sui-integration/
├── sources/                    # Move source files
│   ├── fusion_htlc_v2.move    # HTLC implementation
│   └── fusion_cross_chain.move # Cross-chain manager
├── tests/                      # Move tests
├── scripts/                    # TypeScript utilities
├── contracts/                  # EVM contract files
│   └── SimpleHTLC.sol         # Shared HTLC for testing
├── test-*.ts                   # Test scripts
├── deployment.json             # Sui deployment info
└── sepolia-htlc-deployment.json # Sepolia deployment info
```

## 🔐 Security Features

1. **Hash Validation**
   - Uses keccak256 for EVM compatibility
   - 32-byte secret requirement
   - Preimage resistance

2. **Time Constraints**
   - Minimum 1 hour locktime
   - Maximum 30 days locktime
   - Clock-based validation

3. **Access Control**
   - Only receiver can withdraw
   - Only sender can refund
   - No admin functions

## 📊 Gas Costs

| Operation | Sui Gas | Sepolia Gas |
|-----------|---------|--------------|
| Create HTLC | ~0.004 SUI | ~120k gas |
| Withdraw | ~0.002 SUI | ~50k gas |
| Refund | ~0.002 SUI | ~30k gas |

## 🌐 Supported Chains

| Chain | Chain ID | Status |
|-------|----------|--------|
| Ethereum Sepolia | 11155111 | ✅ Deployed |
| Arbitrum | 42161 | 🔜 Coming |
| Optimism | 10 | 🔜 Coming |
| Base | 8453 | 🔜 Coming |
| Polygon | 137 | 🔜 Coming |
| BSC | 56 | 🔜 Coming |
| Avalanche | 43114 | 🔜 Coming |

## 🚧 Known Issues

- Sui RPC connection timeouts may occur
- EVM gas price fluctuations
- Cross-chain timing coordination

## 📚 Resources

- [Sui Documentation](https://docs.sui.io)
- [1inch Documentation](https://docs.1inch.io)
- [Fusion+ Architecture](./FUSION_PLUS_ARCHITECTURE.md)
- [Shared HTLC Deployment](../SHARED_HTLC_DEPLOYMENT.md)

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Run tests
4. Submit a pull request

## 📜 License

MIT License - see LICENSE file for details