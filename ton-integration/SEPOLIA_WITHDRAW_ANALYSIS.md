# Sepolia HTLC Withdraw Issue Analysis

## Problem Summary
The withdraw transaction on Sepolia HTLC is reverting with "Hashlock does not match" error.

## Root Cause
The issue is NOT with transaction encoding (ethers.js shows empty data in error messages but the actual transaction has correct data). The real issue is that the preimage doesn't produce the expected hashlock.

## What's Happening:
1. **HTLC Creation**: Works correctly with SHA256 hashlock
2. **TON Claim**: Works correctly 
3. **Sepolia Withdraw**: Fails because the contract verifies `sha256(preimage) == hashlock`

## The Issue in Our Test:
When we create the HTLC on Sepolia in our cross-chain test, we're using a generated secret/hashlock pair. But when we try to withdraw, the verification fails.

## Solution for Cross-Chain Test:

The issue is that in a real cross-chain swap, the same secret must be used on both chains. Here's the correct flow:

1. Generate secret/hashlock pair ONCE
2. Create HTLC on Chain A with hashlock
3. Create HTLC on Chain B with SAME hashlock  
4. Reveal secret on Chain B
5. Use SAME secret on Chain A

## Fixed Implementation:

```typescript
// Generate ONCE at the beginning
const { secret, hashlock } = await FusionHTLC.generateSecret();

// Use same hashlock for both HTLCs
const evmHTLC = await createHTLC(hashlock);
const tonHTLC = await createHTLC(hashlock);

// Claim with same secret
await claimTON(secret);
await claimEVM(secret); // This will work because sha256(secret) == hashlock
```

## Why Ethers Shows Empty Data:
This is a known issue with ethers.js v6 error reporting. The transaction actually contains the correct encoded data, but the error object shows empty data. You can verify this by:
1. Checking the transaction hash on Etherscan
2. Looking at the "Transaction data in sent tx" log before the error

## Verification:
Transaction 0xae05bc3a4cfb57dc19742b631613fcf3260feea4687195d2ce9ec2e8dea59fd1 shows:
- Input Data: `0x63615149...` (correct withdraw function call)
- Error: "Hashlock does not match"
- This confirms the transaction is sent correctly but the preimage verification fails