# 1inch Fusion+ Stellar Integration

Production-ready atomic swap implementation for Stellar blockchain using Soroban smart contracts, enabling secure cross-chain swaps through Hash Time-Locked Contracts (HTLCs).

## 🚀 Features

- ✅ **Atomic Swaps**: Secure, trustless swaps using HTLCs on Stellar
- ✅ **Soroban Smart Contracts**: Native Stellar smart contracts with optimal gas efficiency
- ✅ **Cross-Chain Bridge**: Coordinate swaps between Stellar and 10+ other blockchains
- ✅ **TypeScript SDK**: Type-safe, easy-to-use developer interface
- ✅ **Production Contracts**: Gas-optimized Rust contracts with comprehensive security
- ✅ **Testing Suite**: Unit and integration tests with high coverage
- ✅ **Demo Examples**: Working examples for quick onboarding

## 📁 Project Structure

```
stellar-integration/
├── src/                         # Soroban smart contracts (Rust)
│   ├── atomic_swap.rs          # Core HTLC implementation
│   ├── cross_chain_bridge.rs   # Cross-chain coordination
│   ├── types.rs                # Data structures and constants
│   ├── utils.rs                # Utility functions
│   └── lib.rs                  # Library entry point
├── sdk/                        # TypeScript SDK
│   ├── src/                    # SDK source code
│   │   ├── StellarAtomicSwap.ts # Main SDK class
│   │   ├── examples/           # Demo implementations
│   │   └── tests/              # Test suite
│   └── package.json           # SDK dependencies
├── Cargo.toml                  # Rust project configuration
├── package.json               # Node.js dependencies
└── README.md                  # This file
```

## 🏗️ Architecture

### System Architecture

```mermaid
graph TB
    subgraph "User Layer"
        A[dApp Frontend]
        B[CLI Interface]
        C[Freighter Wallet]
    end
    
    subgraph "SDK Layer"
        D[StellarAtomicSwap SDK]
        E[Stellar SDK]
        F[Utility Functions]
    end
    
    subgraph "Stellar Network"
        G[Horizon Server]
        H[Soroban RPC]
        I[Stellar Validators]
    end
    
    subgraph "Soroban Smart Contracts"
        J[atomic_swap.rs]
        K[cross_chain_bridge.rs]
        L[Contract Storage]
        M[Event System]
    end
    
    subgraph "Cross-Chain Integration"
        N[Ethereum Connector]
        O[Bitcoin Connector]
        P[Aptos Connector]
        Q[Sui Connector]
    end
    
    subgraph "Security Components"
        R[Hash Time Locks]
        S[Keccak256 Hashing]
        T[Secret Validation]
        U[Timelock Enforcement]
    end
    
    subgraph "Asset Management"
        V[Native XLM]
        W[Stellar Assets]
        X[Token Contracts]
        Y[Balance Tracking]
    end
    
    A --> D
    B --> D
    C --> D
    
    D --> E
    D --> F
    
    E --> G
    E --> H
    G --> I
    H --> I
    
    E --> J
    E --> K
    J --> L
    K --> L
    J --> M
    K --> M
    
    K --> N
    K --> O
    K --> P
    K --> Q
    
    J --> R
    J --> S
    J --> T
    J --> U
    
    D --> V
    D --> W
    D --> X
    D --> Y
    
    L --> R
    M --> R
    
    style A fill:#e1f5fe
    style D fill:#f3e5f5
    style J fill:#e8f5e8
    style K fill:#e8f5e8
    style R fill:#fff3e0
```

### User Flow Diagram

```mermaid
sequenceDiagram
    participant A as Alice (Initiator)
    participant SDK as StellarAtomicSwap SDK
    participant SC as Soroban Contract
    participant B as Bob (Recipient)
    participant CC as Cross-Chain Bridge
    participant XC as External Chain
    
    Note over A,XC: Direct Atomic Swap
    
    A->>SDK: 1. Generate Secret & Hash
    SDK-->>A: Secret (32 bytes), Hash (SHA-256)
    
    A->>SDK: 2. Initialize Contract
    SDK->>SC: initialize(admin, feeRate)
    SC-->>SDK: Contract Initialized
    
    A->>SDK: 3. Create Swap
    SDK->>SC: create_swap(recipient, amount, secretHash, timelock)
    SC->>SC: Lock XLM/Assets in Contract
    SC-->>SDK: SwapID, Storage Updated
    SDK-->>A: Swap Created Successfully
    
    B->>SDK: 4. Query Swap Status
    SDK->>SC: get_swap(swapID)
    SC-->>SDK: Swap State Details
    SDK-->>B: Active Swap Found
    
    B->>SDK: 5. Complete Swap
    SDK->>SC: complete_swap(swapID, secret)
    SC->>SC: Verify Secret Hash
    SC->>SC: Transfer Assets to Bob
    SC-->>SDK: Swap Completed
    SDK-->>B: Assets Received
    
    Note over A,XC: Cross-Chain Bridge Scenario
    
    A->>SDK: 6. Create Bridge Order
    SDK->>CC: create_outbound_order(destChain, recipient, amount, hash)
    CC->>SC: Lock Stellar Assets
    CC-->>SDK: Bridge Order Created
    SDK-->>A: Cross-Chain Order Active
    
    CC->>XC: 7. Signal External Chain
    XC->>XC: Lock External Assets
    XC-->>CC: External Lock Confirmed
    
    B->>SDK: 8. Complete Cross-Chain Swap
    SDK->>CC: complete_bridge_order(orderID, secret)
    CC->>SC: Release Stellar Assets
    CC->>XC: Release External Assets
    CC-->>SDK: Cross-Chain Complete
    SDK-->>B: Bridge Swap Successful
    
    Note over A,XC: Refund Scenario
    
    A->>SDK: 9. Check Expiry
    SDK->>SC: can_refund(swapID)
    SC-->>SDK: Refund Available
    
    A->>SDK: 10. Refund Expired Swap
    SDK->>SC: refund_swap(swapID)
    SC->>SC: Validate Timelock Expired
    SC->>SC: Return Assets to Alice
    SC-->>SDK: Refund Complete
    SDK-->>A: Assets Returned
```

## 🔧 Quick Start

### Installation

```bash
# Clone and navigate to project
cd stellar-integration

# Install Node.js dependencies
npm install

# Install Rust dependencies
cargo check

# Build TypeScript SDK
npm run build

# Compile Soroban contracts
npm run build:contracts
```

### Basic Usage

```typescript
import { StellarAtomicSwap, STELLAR_NETWORKS, Utils } from '@1inch/fusion-plus-stellar';

// Initialize SDK
const swapSDK = new StellarAtomicSwap({
    network: STELLAR_NETWORKS.testnet,
    contractAddress: 'CCONTRACT_ADDRESS_HERE',
    keypair: yourKeypair,
});

// Create test accounts (testnet only)
const alice = await StellarAtomicSwap.createTestAccount('testnet');
const bob = await StellarAtomicSwap.createTestAccount('testnet');

// Generate atomic swap secret
const secret = StellarAtomicSwap.generateSecret();
const secretHash = StellarAtomicSwap.generateHashlock(secret);

// Create atomic swap
const swapResult = await swapSDK.createSwap({
    recipient: bob.publicKey,
    amount: '1000000', // 0.1 XLM (in stroops)
    secretHash,
    timelock: StellarAtomicSwap.calculateTimelock(3600), // 1 hour
});

// Complete swap (Bob reveals secret to claim)
const completeResult = await swapSDK.completeSwap({
    swapId: swapResult.swapId,
    secret,
});
```

### Cross-Chain Bridge

```typescript
// Create outbound bridge order (Stellar → Ethereum)
const bridgeResult = await swapSDK.createBridgeOrder({
    destinationChainId: 2, // Ethereum
    recipient: 'ethereum_address_here',
    amount: '10000000', // 1 XLM
    secretHash,
    timelock: StellarAtomicSwap.calculateTimelock(7200), // 2 hours
});
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run Soroban contract tests
npm run test:contracts

# Run with coverage
npm test -- --coverage

# Run integration tests (requires network)
npm run test:integration
```

## 🚀 Deployment

### Development (Testnet)

```bash
# Deploy to Stellar testnet
npm run deploy:testnet
```

### Production (Mainnet)

```bash
# Deploy to Stellar mainnet
npm run deploy:mainnet
```

## 📖 API Reference

### StellarAtomicSwap Class

#### Constructor

```typescript
new StellarAtomicSwap(config: StellarAtomicSwapConfig)
```

#### Core Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `generateSecret()` | Generate random secret for swap | `string` |
| `generateHashlock(secret)` | Create hash of secret | `string` |
| `createSwap(params)` | Create new atomic swap | `Promise<SwapResult>` |
| `completeSwap(params)` | Complete swap with secret | `Promise<CompleteResult>` |
| `refundSwap(swapId)` | Refund expired swap | `Promise<RefundResult>` |
| `getSwap(swapId)` | Get swap details | `Promise<SwapState>` |

#### Bridge Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `createBridgeOrder(params)` | Create Stellar → Other chain order | `Promise<BridgeResult>` |
| `completeBridgeOrder(...)` | Complete bridge order | `Promise<CompleteResult>` |
| `getBridgeOrder(orderId)` | Get bridge order details | `Promise<BridgeOrder>` |

#### Utility Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getBalance(asset?)` | Get account balance | `Promise<string>` |
| `createTestAccount()` | Create funded test account | `Promise<Account>` |
| `verifySecret(secret, hash)` | Verify secret against hash | `boolean` |

## 🔒 Security Features

### Smart Contract Security

- **Reentrancy Protection**: Guards against reentrancy attacks
- **Timelock Validation**: Enforces minimum/maximum timelock durations
- **Hash Verification**: Cryptographic secret validation using Keccak256
- **Authorization Checks**: Proper access control for all operations
- **Event Emission**: Comprehensive event logging for transparency

### SDK Security

- **Input Validation**: Comprehensive parameter validation
- **Type Safety**: Full TypeScript coverage prevents runtime errors
- **Network Validation**: Stellar network configuration validation
- **Error Handling**: Graceful error handling and recovery
- **Private Key Management**: Secure key handling with Stellar SDK

## 🌐 Supported Chains

| Chain | Chain ID | Status |
|-------|----------|--------|
| Stellar | 1 | ✅ Native |
| Ethereum | 2 | ✅ Active |
| Bitcoin | 3 | ✅ Active |
| Aptos | 4 | ✅ Active |
| Sui | 5 | ✅ Active |
| Polygon | 6 | ✅ Active |
| Arbitrum | 7 | ✅ Active |
| Optimism | 8 | ✅ Active |
| BSC | 9 | ✅ Active |
| Avalanche | 10 | ✅ Active |

## 🛠 Development

### Code Quality

```bash
# Lint TypeScript
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Clean build artifacts
npm run clean
```

### Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit pull request

## 📄 License

MIT License - see [LICENSE](../LICENSE) for details.

## 🔗 Links

- [1inch Fusion+ Documentation](https://docs.1inch.io/docs/fusion-plus/introduction)
- [Stellar Documentation](https://developers.stellar.org/)
- [Soroban Documentation](https://soroban.stellar.org/docs)
- [1inch Bounty Program](https://github.com/1inch/fusion-plus-bounty)

## 🆘 Support

- [GitHub Issues](https://github.com/1inch/fusion-plus/issues)
- [1inch Discord](https://discord.gg/1inch)
- [Developer Telegram](https://t.me/OneInchDevPortal)

---

**Built with ❤️ by the 1inch team for the Stellar ecosystem** 