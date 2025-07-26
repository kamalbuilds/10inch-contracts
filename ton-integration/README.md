# 10inch >> 1inch Fusion Plus - TON Integration

This integration enables cross-chain atomic swaps between TON blockchain and EVM-compatible chains using the 1inch Fusion Plus protocol.

## Overview

The TON integration implements  in FunC to enable trustless cross-chain swaps. It follows the same architectural patterns (1inch) as other Fusion Plus integrations while adapting to TON's unique features.

## Architecture []

### Core Components

1. **HTLC Smart Contract** (`contracts/fusion_htlc.fc`)
   - Written in FunC, TON's smart contract language
   - Implements hash locks and time locks
   - Supports claim with secret reveal and refund after timeout

2. **TypeScript SDK** (`src/ton-fusion-client.ts`)
   - High-level API for interacting with TON HTLCs
   - Wallet management and transaction building
   - Secret generation and validation

3. **Relayer Service** (`src/relayer/`)
   - Monitors both TON and EVM chains for HTLC events
   - Coordinates cross-chain atomic swaps
   - Handles secret relay between chains 

4. **Deployment Scripts** (`scripts/`)
   - Automated deployment to TON testnet/mainnet
   - Cross-chain swap testing utilities



## Features

- ✅ Bidirectional swaps (TON ↔ EVM)
- ✅ Hash Time-Locked Contracts in FunC
- ✅ TypeScript SDK for easy integration
- ✅ Automated relayer service
- ✅ Testnet deployment scripts
- ✅ Comprehensive test suite
- ✅ Partial fill support
- ✅ Testnet deployment complete!
- 🚧 Mainnet deployment (coming soon)

## Quick Start

### Prerequisites

- Node.js v18+
- TON wallet with testnet tokens
- EVM wallet with testnet ETH

### Installation

```bash
npm install
```

### Configuration

Create a `.env` file:

```env
# TON Configuration
TON_MNEMONIC="your 24 word mnemonic here"
TON_API_KEY=your_toncenter_api_key # Optional

# EVM Configuration (e.g., Sepolia)
EVM_RPC_URL=https://sepolia.infura.io/v3/YOUR-PROJECT-ID
EVM_HTLC_ADDRESS=0x... # Deploy EVM HTLC first
EVM_PRIVATE_KEY=0x...
```

### Deployment

1. **Deploy TON HTLC Contract:**

```bash
npm run build # Compile FunC contracts
npx ts-node scripts/deploy-testnet.ts
```

2. **Deploy EVM HTLC Contract:**
Use the existing 1inch Fusion contracts on your target EVM chain.

### Testing Cross-Chain Swaps

** CrossChain

npx ts-node scripts/test-crosschain-working.ts

1. **Test EVM to TON swap:**

```bash
npx ts-node scripts/test-evm-to-ton.ts
```

2. **Test TON to EVM swap:**

```bash
npx ts-node scripts/test-ton-to-evm.ts
```

## Usage Example

### Creating a Cross-Chain Swap

```typescript
import { TonFusionClient } from '@ton-integration/sdk';
import { generateSecret, calculateTimelock } from '@ton-integration/utils';

// Initialize client
const client = new TonFusionClient();
await client.init(mnemonic);

// Generate swap parameters
const { secret, hashlock } = generateSecret();
const timelock = calculateTimelock(3600); // 1 hour

// Create HTLC on TON
const htlcId = await client.createHTLC({
    receiver: '0x...', // EVM address
    amount: toNano('1'), // 1 TON
    hashlock,
    timelock
});

// Later, claim with secret
await client.claimHTLC(htlcId, secret);
```

### Running the Relayer

```typescript
import { FusionRelayer } from '@ton-integration/relayer';

const relayer = new FusionRelayer({
    tonRpcUrl: 'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac55b0/api/v2/jsonRPC',
    evmRpcUrl: 'https://sepolia.infura.io/v3/YOUR-KEY',
    tonHTLCAddress: Address.parse('...'),
    evmHTLCAddress: '0x...',
    walletMnemonic: 'your mnemonic'
});

await relayer.init();
await relayer.startMonitoring();
```

## Smart Contract Interface

### FunC HTLC Operations

- `create_htlc` - Create a new HTLC with specified parameters
- `claim` - Claim funds by revealing the secret
- `refund` - Refund funds after timelock expiry

### Get Methods

- `get_htlc(htlc_id)` - Get HTLC details
- `get_next_htlc_id()` - Get the next available HTLC ID

## Security Considerations

1. **Timelock Safety**: Target chain HTLCs should have shorter timelocks than source chain
2. **Secret Generation**: Use cryptographically secure random number generation
3. **Address Validation**: Properly validate cross-chain address formats
4. **Gas Management**: Ensure sufficient gas/fees on both chains

## Development

### Building Contracts

```bash
npm run build
```

### Running Tests

```bash
npm test
```

### Code Structure

```
ton-integration/
├── contracts/          # FunC smart contracts
│   └── fusion_htlc.fc
├── src/               # TypeScript SDK
│   ├── ton-fusion-client.ts
│   ├── relayer/
│   ├── types.ts
│   └── utils.ts
├── scripts/           # Deployment and testing
├── tests/            # Test suite
└── wrappers/         # Contract wrappers
```

## Integration Checklist

- [x] FunC HTLC contract implementation
- [x] TypeScript SDK
- [x] Relayer service
- [x] Deployment scripts
- [x] Cross-chain swap tests
- [ ] Resolver service implementation
- [ ] Partial fill support
- [ ] UI integration
- [ ] Mainnet deployment
- [ ] Audit and security review

## Resources

- [TON Documentation](https://docs.ton.org)
- [FunC Programming Guide](https://docs.ton.org/develop/func/overview)
- [1inch Fusion Plus Docs](https://docs.1inch.io/fusion-plus)
- [Cross-chain Resolver Example](https://github.com/1inch/cross-chain-resolver-example)

## Support

For questions and support:
- 1inch Discord: [discord.gg/1inch](https://discord.gg/1inch)
- TON Developer Chat: [t.me/tondev](https://t.me/tondev)

## License

MIT
