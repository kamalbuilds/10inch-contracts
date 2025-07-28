#!/bin/bash

# Optimize CosmWasm contracts locally (without Docker)
echo "Optimizing CosmWasm contracts locally..."

# Create artifacts directory
mkdir -p artifacts

# Optimize each contract
for contract in atomic_swap cross_chain_bridge resolver; do
    echo "Building optimized $contract..."
    cd contracts/$contract
    
    # Build with optimization flags
    RUSTFLAGS='-C link-arg=-s' cargo build --release --target wasm32-unknown-unknown
    
    # Copy to artifacts
    cp ../../target/wasm32-unknown-unknown/release/cosmos_${contract}.wasm ../../artifacts/
    
    cd ../..
done

# Check if wasm-opt is available for further optimization
if command -v wasm-opt &> /dev/null; then
    echo "Running wasm-opt for additional optimization..."
    for wasm_file in artifacts/*.wasm; do
        echo "Optimizing $wasm_file..."
        wasm-opt -Os "$wasm_file" -o "${wasm_file%.wasm}_optimized.wasm"
        mv "${wasm_file%.wasm}_optimized.wasm" "$wasm_file"
    done
else
    echo "wasm-opt not found. Skipping additional optimization."
    echo "Install with: npm install -g wasm-opt"
fi

echo "Optimization complete!"
ls -la artifacts/