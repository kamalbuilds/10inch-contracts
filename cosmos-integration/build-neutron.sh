#!/bin/bash

echo "Building contracts for Neutron testnet..."

# Create artifacts directory
mkdir -p artifacts

# Build each contract with minimal features
for contract in atomic_swap cross_chain_bridge resolver; do
    echo "Building $contract..."
    cd contracts/$contract
    
    # Build with minimal features and proper target
    RUSTFLAGS='-C link-arg=-s -C opt-level=3' cargo build --release --target wasm32-unknown-unknown --no-default-features --features "stargate"
    
    cd ../..
done

# Copy artifacts
echo "Copying artifacts..."
cp target/wasm32-unknown-unknown/release/*.wasm artifacts/

# Check sizes
echo -e "\nContract sizes:"
ls -lh artifacts/*.wasm

# Validate contracts
echo -e "\nValidating contracts..."
cosmwasm-check artifacts/*.wasm