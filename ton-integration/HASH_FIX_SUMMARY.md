# Cross-Chain Hash Verification Fix Summary

## Problem
The cross-chain swap was failing with **"Hashlock does not match"** error when claiming HTLCs between TON and Ethereum.

## Root Cause
The issue was in the byte order/endianness handling between TypeScript and FunC:

1. **TypeScript side**: Created 32-byte Buffer → hashed with `sha256(buffer)` → stored with `.storeBuffer(secret, 32)`
2. **TON FunC side**: Loaded with `load_uint(256)` → converted bytes to big-endian integer → converted back to bytes for hashing
3. **Result**: Different byte sequences were being hashed on each side

## Solution
Updated the TON FunC contract to handle secrets as raw bytes instead of integers:

### Key Changes Made:

1. **Message parsing**: Changed from `load_uint(256)` to `load_bits(256)`
   ```funC
   // Before
   int secret = in_msg_body~load_uint(256);
   
   // After  
   slice secret_slice = in_msg_body~load_bits(256);
   ```

2. **Hash verification**: Direct hashing of raw bytes
   ```funC
   // Before
   slice secret_slice = begin_cell().store_uint(secret, 256).end_cell().begin_parse();
   int secret_hash = string_hash(secret_slice);
   
   // After
   int secret_hash = string_hash(secret_slice);
   ```

3. **Function signatures**: Updated to work with slice instead of int
   ```funC
   // Before
   () claim_htlc(int htlc_id, int secret, slice claimer_address)
   
   // After
   () claim_htlc(int htlc_id, slice secret_slice, slice claimer_address)
   ```

4. **Storage format**: Updated HTLC data structure to store secrets as raw bits

## Test Results
✅ **SUCCESS**: The "Hashlock does not match" error is now resolved!

Evidence from test run:
- ✅ Hash generation: "Hashes match: true"
- ✅ TON HTLC creation succeeded
- ✅ **TON HTLC claimed with secret!** (No hash verification error)
- ✅ Cross-chain compatibility confirmed

## Technical Details
- Contract address: `EQBimjZjT5CpjQ2W1lfXSdsRSjYSAEld6lkseQ0dy-cSCefJ`
- Both sides now hash the exact same 32-byte sequence
- Uses `string_hash()` which implements standard SHA256 in TON
- Maintains compatibility with existing getter methods

## Status
🎉 **FIXED**: Cross-chain hash verification now works correctly between TON and Ethereum chains.