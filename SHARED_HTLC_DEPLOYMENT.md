# 1inch Fusion+ Shared HTLC Deployment

## Overview

This document contains the shared Hash Time-Locked Contract (HTLC) deployment information for testing cross-chain swaps between EVM and non-EVM chains in the 1inch Fusion+ ecosystem.

## Deployed Contract

### Ethereum Sepolia Testnet

- **Contract Address**: `0x067423CA883d8D54995735aDc1FA23c17e5b62cc`
- **Contract Type**: SimpleHTLC
- **Deployment Block**: 8850810
- **Deployment Transaction**: [0x27740061d0c030cc9b7c51bcd54a12f36407c6c0bf0aa317849f0f60d721b909](https://sepolia.etherscan.io/tx/0x27740061d0c030cc9b7c51bcd54a12f36407c6c0bf0aa317849f0f60d721b909)
- **Deployer**: `0x666446eC2343e9E7e3D75C4C5b6A15355Ec7d7D4`
- **View on Etherscan**: [https://sepolia.etherscan.io/address/0x067423CA883d8D54995735aDc1FA23c17e5b62cc](https://sepolia.etherscan.io/address/0x067423CA883d8D54995735aDc1FA23c17e5b62cc)

## Contract Interface

### Functions

#### createHTLC
```solidity
function createHTLC(
    address _receiver,
    bytes32 _hashlock,
    uint256 _timelock
) external payable returns (bytes32 contractId)
```
- Creates a new HTLC with ETH
- Returns a unique contract ID
- Emits `HTLCCreated` event

#### withdraw
```solidity
function withdraw(bytes32 _contractId, bytes32 _preimage) external
```
- Withdraws funds by providing the correct preimage
- Only the receiver can withdraw
- Emits `HTLCWithdrawn` event

#### refund
```solidity
function refund(bytes32 _contractId) external
```
- Refunds funds after timelock expires
- Only the sender can refund
- Emits `HTLCRefunded` event

#### getContract
```solidity
function getContract(bytes32 _contractId) external view returns (
    address sender,
    address receiver,
    uint256 amount,
    bytes32 hashlock,
    uint256 timelock,
    bool withdrawn,
    bool refunded,
    bytes32 preimage
)
```
- Returns all details of an HTLC

## Integration Guide

### For Non-EVM Chains

1. **Sui Integration**
   ```typescript
   const SEPOLIA_HTLC = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';
   ```

2. **Aptos Integration**
   ```move
   const SEPOLIA_HTLC_ADDRESS: vector<u8> = x"067423CA883d8D54995735aDc1FA23c17e5b62cc";
   ```

3. **TON Integration**
   ```func
   const sepolia_htlc_address = "0x067423CA883d8D54995735aDc1FA23c17e5b62cc"c;
   ```

4. **Other Chains**
   - Use the same contract address for all EVM testnet integrations
   - Ensure hashlock compatibility (keccak256)
   - Convert timelock to seconds (Unix timestamp)

## Cross-Chain Swap Flow

### Non-EVM → EVM (e.g., Sui → Sepolia)

1. **User creates order on Non-EVM chain**
   - Generates secret and hashlock
   - Creates swap order with hashlock

2. **Resolver accepts order**
   - Locks funds on Non-EVM chain with HTLC
   - Creates HTLC on Sepolia with same hashlock

3. **User reveals secret on Sepolia**
   ```javascript
   await htlcContract.withdraw(contractId, secret);
   ```

4. **Resolver uses revealed secret on Non-EVM chain**
   - Claims locked funds using the same secret

### EVM → Non-EVM (e.g., Sepolia → Sui)

1. **User creates HTLC on Sepolia**
   ```javascript
   const tx = await htlcContract.createHTLC(
       receiverAddress,
       hashlock,
       timelock,
       { value: ethAmount }
   );
   ```

2. **Resolver creates matching HTLC on Non-EVM chain**
   - Uses same hashlock
   - Locks equivalent funds

3. **User reveals secret on Non-EVM chain**
   - Claims funds with preimage

4. **Resolver withdraws on Sepolia**
   ```javascript
   await htlcContract.withdraw(contractId, secret);
   ```

## Example Code

### JavaScript/TypeScript
```typescript
import { ethers } from 'ethers';

const HTLC_ADDRESS = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';
const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia.publicnode.com');

// Generate secret and hashlock
const secret = ethers.randomBytes(32);
const hashlock = ethers.keccak256(secret);

// Create HTLC
const htlc = new ethers.Contract(HTLC_ADDRESS, abi, signer);
const tx = await htlc.createHTLC(
    receiverAddress,
    hashlock,
    Math.floor(Date.now() / 1000) + 3600, // 1 hour
    { value: ethers.parseEther('0.1') }
);
```

### Important Notes

1. **Hashlock Compatibility**
   - Use keccak256 for hash function
   - 32-byte secrets recommended

2. **Timelock Format**
   - Unix timestamp in seconds
   - Must be future time for creation
   - Allow sufficient time for cross-chain coordination

3. **Gas Considerations**
   - createHTLC: ~120,000 gas
   - withdraw: ~50,000 gas
   - refund: ~30,000 gas

## Testing Endpoints

- **Sepolia RPC**: `https://ethereum-sepolia.publicnode.com`
- **Sepolia Faucet**: [https://sepoliafaucet.com](https://sepoliafaucet.com)
- **Block Explorer**: [https://sepolia.etherscan.io](https://sepolia.etherscan.io)

## Security Considerations

1. **Secret Generation**
   - Use cryptographically secure random number generator
   - Never reuse secrets
   - Keep secrets private until reveal

2. **Timelock Settings**
   - Minimum: 1 hour recommended
   - Maximum: 24 hours recommended
   - Consider network congestion

3. **Amount Validation**
   - Verify amounts match on both chains
   - Account for gas costs
   - Include safety margins

## Contract ABI

The full ABI is available in:
- `sui-integration/sepolia-htlc-deployment.json`
- `shared-htlc-deployment.json`

## Support

For issues or questions:
- GitHub: [1inch/fusion-plus-integrations](https://github.com/1inch/fusion-plus-integrations)
- Documentation: [docs.1inch.io](https://docs.1inch.io)

## Future Deployments

| Network | Status | Address |
|---------|--------|---------|
| Ethereum Mainnet | Planned | TBD |
| Arbitrum | Planned | TBD |
| Optimism | Planned | TBD |
| Base | Planned | TBD |
| Polygon | Planned | TBD |
| BSC | Planned | TBD |
| Avalanche | Planned | TBD |