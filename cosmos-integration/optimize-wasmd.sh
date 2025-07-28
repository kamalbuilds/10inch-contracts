#!/bin/bash

# Optimize CosmWasm contracts for wasmd compatibility
echo "Building contracts with wasmd-compatible settings..."

# Create artifacts directory
mkdir -p artifacts

# Build each contract with proper flags
for contract in atomic_swap cross_chain_bridge resolver; do
    echo "Building $contract..."
    cd contracts/$contract
    
    # Build with proper flags for wasmd compatibility
    RUSTFLAGS='-C link-arg=-s' cargo build --release --target wasm32-unknown-unknown --no-default-features
    
    cd ../..
done

# Copy to artifacts
echo "Copying contracts to artifacts..."
cp target/wasm32-unknown-unknown/release/cosmos_atomic_swap.wasm artifacts/
cp target/wasm32-unknown-unknown/release/cosmos_cross_chain_bridge.wasm artifacts/
cp target/wasm32-unknown-unknown/release/cosmos_resolver.wasm artifacts/

echo "Build complete!"
ls -lh artifacts/