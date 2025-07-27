# 🔗 True Cross-Chain Setup Guide

## Overview

This guide explains how to run the **true cross-chain atomic swap demonstration** that creates real HTLCs on both Stellar and Ethereum Sepolia.

## Prerequisites

### 1. Ethereum Sepolia Setup
```bash
# Get Sepolia ETH from faucet
# Visit: https://sepoliafaucet.com

# Set your private key (replace with your actual private key)
export ETHEREUM_PRIVATE_KEY="0x1234567890123456789012345678901234567890123456789012345678901234"
```

### 2. Stellar Testnet Setup
```bash
# Ensure Stellar CLI is configured
stellar keys list

# Should show:
# - deployer
# - receiver
```

### 3. Dependencies
```bash
npm install ethers
```

## Running the True Cross-Chain Demo

### Step 1: Set Environment Variables
```bash
# Set your Ethereum private key (REQUIRED)
export ETHEREUM_PRIVATE_KEY="your_actual_private_key_here"

# Verify it's set
echo $ETHEREUM_PRIVATE_KEY
```

### Step 2: Run the Demo
```bash
npx ts-node true-crosschain-demo.ts
```

## What the Demo Does

### 1. **Stellar HTLC Creation**
- Creates a real HTLC on Stellar testnet
- Uses the deployed contract: `CATGJPI3BE2LJHDHYXKNUAELSLHN4BYVPZTIQ7T2RGDWA5L67DUAWW5D`
- Locks Stellar tokens with a hashlock

### 2. **Ethereum HTLC Creation**
- Creates a real HTLC on Ethereum Sepolia
- Uses the pre-deployed contract: `0x067423CA883d8D54995735aDc1FA23c17e5b62cc`
- Locks ETH with the **same hashlock**

### 3. **Cross-Chain Verification**
- Verifies both HTLCs exist
- Confirms they use the same hashlock
- Shows transaction details on both chains

### 4. **Atomic Swap Flow**
- Demonstrates the complete atomic swap process
- Shows how to complete the swap using the secret

## Expected Output

```
🚀 TRUE CROSS-CHAIN ATOMIC SWAP DEMO
📋 Stellar Contract: CATGJPI3BE2LJHDHYXKNUAELSLHN4BYVPZTIQ7T2RGDWA5L67DUAWW5D
📋 Ethereum HTLC: 0x067423CA883d8D54995735aDc1FA23c17e5b62cc
🎯 Status: REAL CROSS-CHAIN EXECUTION
🔑 Secret: c19bc921e9ab0ebcf5d78b3ae9879475d0051c11affe6156b4d983f03d397ba2
🔒 Hashlock: c59922dee0bcb48189aa08f3cff398bf2dc0589a67b56c3432e8d164425b74c7
💰 Stellar Amount: 1000000
💰 Ethereum Amount: 0.001 ETH

🔧 Step 1: Initializing Cross-Chain Infrastructure...
✅ Stellar HTLC initialized
✅ Stellar Relayer initialized
✅ Ethereum connection established
💰 Ethereum balance: 0.1 ETH
✅ Cross-chain infrastructure ready!

🌟 Step 2: Creating HTLC on Stellar...
🎉 Stellar HTLC created successfully!
📋 HTLC ID: 1

🔗 Step 3: Creating HTLC on Ethereum Sepolia (REAL TRANSACTION)...
🔧 Creating Ethereum HTLC with:
   Receiver: 0x742dA3c89CdDaA0ec77C4e4a52E5Ff5E81F7BdED
   Hashlock: 0xc59922dee0bcb48189aa08f3cff398bf2dc0589a67b56c3432e8d164425b74c7
   Timelock: 1754213596
   Amount: 0.001 ETH
⏳ Waiting for Ethereum transaction confirmation...
📋 Transaction hash: 0x1234567890abcdef...
✅ Ethereum HTLC created successfully!
📋 Block number: 12345678
📋 Gas used: 120000
📋 Contract ID: 0xabcdef1234567890...

🔍 Step 4: Verifying Cross-Chain Coordination...
🌟 Stellar HTLC Details: [HTLC data]
🔗 Ethereum HTLC Details:
   Sender: 0x...
   Receiver: 0x742dA3c89CdDaA0ec77C4e4a52E5Ff5E81F7BdED
   Amount: 0.001 ETH
   Hashlock: 0xc59922dee0bcb48189aa08f3cff398bf2dc0589a67b56c3432e8d164425b74c7
   Timelock: 2025-08-03T09:33:16.000Z
   Withdrawn: false
   Refunded: false
✅ Cross-chain coordination verified!
🔒 Both HTLCs created with same hashlock: c59922dee0bcb48189aa08f3cff398bf2dc0589a67b56c3432e8d164425b74c7

⚡ Step 5: Atomic Swap Flow Demonstration...
🔄 Complete Atomic Swap Flow:
   1. ✅ User creates HTLC on Stellar (COMPLETED)
   2. ✅ Relayer creates HTLC on Ethereum (COMPLETED)
   3. 🔄 User reveals secret on Ethereum to claim ETH
   4. 🔄 Relayer uses secret to complete Stellar HTLC

🔐 Secret for withdrawal: c19bc921e9ab0ebcf5d78b3ae9879475d0051c11affe6156b4d983f03d397ba2
🔑 Hashlock for verification: c59922dee0bcb48189aa08f3cff398bf2dc0589a67b56c3432e8d164425b74c7
⏰ Timelock expiry: 2025-08-03T09:33:16.000Z

💡 To complete the atomic swap:
   1. Call withdraw() on Ethereum HTLC with the secret
   2. Call complete_order() on Stellar with the same secret
   3. Both transactions must succeed for atomic swap to complete

🏆 === TRUE CROSS-CHAIN DEMONSTRATION COMPLETE ===
🎯 Cross-Chain Integration: FULLY OPERATIONAL
✅ Stellar HTLC: CREATED
✅ Ethereum HTLC: CREATED
✅ Same hashlock: VERIFIED
✅ Atomic swap flow: READY

🚀 READY FOR PRODUCTION CROSS-CHAIN SWAPS!
📈 Business Impact: Real cross-chain atomic swaps
🔧 Technical Achievement: Multi-chain HTLC coordination
🌟 Mission Status: CROSS-CHAIN ACCOMPLISHED
```

## Troubleshooting

### Common Issues

1. **"Ethereum connection failed"**
   - Check internet connection
   - Verify RPC endpoint is accessible

2. **"Insufficient funds"**
   - Get Sepolia ETH from faucet
   - Ensure account has enough balance

3. **"Invalid private key"**
   - Verify ETHEREUM_PRIVATE_KEY is set correctly
   - Ensure private key starts with "0x"

4. **"Transaction failed"**
   - Check gas settings
   - Verify timelock is in the future
   - Ensure sufficient ETH for gas

### Getting Sepolia ETH

1. Visit [Sepolia Faucet](https://sepoliafaucet.com)
2. Connect your wallet
3. Request test ETH
4. Wait for confirmation

## Security Notes

- **Never use real private keys** in test environments
- **Never commit private keys** to version control
- **Use testnet accounts** only for development
- **Verify contract addresses** before transactions

## Next Steps

After running the demo successfully:

1. **Complete the atomic swap** by revealing the secret
2. **Test refund scenarios** after timelock expiry
3. **Integrate with 1inch Fusion+** for production use
4. **Deploy to mainnet** when ready

## Support

For issues or questions:
- Check the troubleshooting section above
- Review the contract documentation
- Contact the development team 