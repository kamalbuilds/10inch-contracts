#!/bin/bash

echo "Simple optimization for CosmWasm contracts..."

# First, let's try using wasm-opt if available
if command -v wasm-opt &> /dev/null; then
    echo "Using wasm-opt for optimization..."
    for wasm in artifacts/*.wasm; do
        echo "Optimizing $wasm..."
        wasm-opt -Os "$wasm" -o "${wasm}.opt"
        mv "${wasm}.opt" "$wasm"
    done
else
    echo "wasm-opt not found. Install with: brew install binaryen"
fi

# Alternative: Try using the optimizer in a different way
echo "Trying Docker with simplified approach..."

# Run optimizer with platform flag
docker run --rm \
    --platform linux/amd64 \
    -v "$(pwd)":/workspace \
    -w /workspace \
    cosmwasm/optimizer:0.15.1 \
    ./contracts/*/Cargo.toml 2>/dev/null || echo "Docker optimization failed"

# Check if optimized files exist
if [ -d "artifacts" ] && [ "$(ls -A artifacts/*.wasm 2>/dev/null)" ]; then
    echo "Contracts found in artifacts:"
    ls -la artifacts/*.wasm
else
    echo "No optimized contracts found. Using existing builds."
fi