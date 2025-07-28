# Cosmos Integration Deployment Instructions

## Overview
This guide provides instructions for deploying the 1inch Fusion+ Cosmos integration contracts to Neutron testnet.

## Prerequisites

1. **Rust and Cargo** - Latest stable version
2. **cosmwasm-check** - Install with: `cargo install cosmwasm-check`
3. **Node.js** - v16 or higher
4. **Testnet tokens** - Get from:
   - Telegram: https://t.me/neutron_faucet_bot
   - Discord: https://discord.gg/neutron (use #testnet-faucet channel)

## Contract Architecture

1. **Atomic Swap Contract** - Handles HTLC-based atomic swaps on Cosmos
2. **Cross-Chain Bridge Contract** - Manages IBC-based cross-chain orders
3. **Resolver Contract** - Implements resolver pattern for trustless cross-chain coordination

## Build Instructions

1. **Clone the repository**
   ```bash
   git clone <your-repo>
   cd cosmos-integration
   ```

2. **Build contracts**
   ```bash
   # Build all contracts
   cargo build --release --target wasm32-unknown-unknown
   
   # Or use the optimization script
   ./optimize-contracts-local.sh
   ```

3. **Validate contracts**
   ```bash
   cosmwasm-check artifacts/*.wasm
   ```

## Deployment Steps

### Option 1: Using Docker (Recommended)

If you have Docker installed, use the CosmWasm optimizer:

```bash
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.15.1
```

### Option 2: Manual Deployment

1. **Set up environment**
   ```bash
   # Export your mnemonic
   export MNEMONIC="your twelve word mnemonic phrase goes here"
   
   # Install dependencies
   npm install
   ```

2. **Deploy contracts**
   ```bash
   npx ts-node scripts/deploy-neutron.ts
   ```

### Option 3: Using wasmd CLI

1. **Install wasmd**
   ```bash
   # Download the appropriate binary for your system
   # From: https://github.com/CosmWasm/wasmd/releases
   ```

2. **Configure wasmd**
   ```bash
   wasmd config chain-id pion-1
   wasmd config node https://rpc-falcron.pion-1.ntrn.tech:443
   wasmd config keyring-backend test
   ```

3. **Add your key**
   ```bash
   wasmd keys add deployer --recover
   # Enter your mnemonic when prompted
   ```

4. **Deploy contracts**
   ```bash
   # Store contract code
   wasmd tx wasm store artifacts/cosmos_atomic_swap.wasm \
     --from deployer \
     --gas auto \
     --gas-prices 0.025untrn \
     --gas-adjustment 1.3 \
     -y
   
   # Get the code ID from the transaction
   CODE_ID=<code_id_from_tx>
   
   # Instantiate contract
   wasmd tx wasm instantiate $CODE_ID '{
     "protocol_fee_bps": 50,
     "min_timelock_duration": 3600,
     "max_timelock_duration": 86400
   }' \
     --from deployer \
     --label "1inch-fusion-atomic-swap" \
     --gas auto \
     --gas-prices 0.025untrn \
     --gas-adjustment 1.3 \
     -y
   ```

## Testing the Deployment

1. **Query contract config**
   ```bash
   wasmd query wasm contract-state smart <contract_address> '{"config":{}}'
   ```

2. **Create a test swap**
   ```bash
   wasmd tx wasm execute <contract_address> '{
     "create_swap": {
       "recipient": "neutron1...",
       "secret_hash": "0x...",
       "timelock": 3600
     }
   }' \
     --from deployer \
     --amount 1000000untrn \
     --gas auto \
     --gas-prices 0.025untrn \
     -y
   ```

## Network Information

- **Chain ID**: pion-1
- **RPC**: https://rpc-falcron.pion-1.ntrn.tech
- **Denom**: untrn (1 NTRN = 1,000,000 untrn)
- **Gas Price**: 0.025untrn

## Common Issues

1. **"reference-types not enabled" error**
   - This happens with older CosmWasm versions
   - Solution: Use the Docker optimizer or update to cosmwasm-std v1.5+

2. **Insufficient gas**
   - Increase gas adjustment: `--gas-adjustment 1.5`
   - Or use a fixed gas amount: `--gas 5000000`

3. **IBC channel not found**
   - Verify IBC channels with: `wasmd query ibc channel channels`
   - Update channel IDs in contract configuration

## Integration with EVM

To complete the cross-chain integration:

1. Deploy the EVM resolver contracts (see `../evm-contracts/`)
2. Configure relayer service with both chain endpoints
3. Update channel configurations in contracts
4. Test end-to-end flow with small amounts first

## Support

For issues or questions:
- Check the logs: `scripts/logs/`
- Neutron Discord: https://discord.gg/neutron
- CosmWasm Documentation: https://docs.cosmwasm.com/