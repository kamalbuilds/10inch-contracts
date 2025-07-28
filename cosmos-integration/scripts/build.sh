#!/bin/bash

set -e

echo "Building CosmWasm contracts..."

# Build contracts
cargo build --release --target wasm32-unknown-unknown

# Create artifacts directory
mkdir -p artifacts

# Copy and optimize contracts
for contract in atomic_swap cross_chain_bridge; do
    echo "Optimizing $contract..."
    docker run --rm -v "$(pwd)":/code \
        --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
        --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
        cosmwasm/rust-optimizer:0.12.13
done

# Move optimized contracts to artifacts
mv artifacts/*.wasm artifacts/

echo "Building TypeScript SDK..."
npm install
npm run build

echo "Build complete!"