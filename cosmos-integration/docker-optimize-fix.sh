#!/bin/bash

echo "Optimizing CosmWasm contracts with Docker..."

# Create artifacts directory
mkdir -p artifacts

# Run optimizer for each contract separately
for contract in atomic_swap cross_chain_bridge resolver; do
    echo "Optimizing $contract..."
    
    # Create a temporary directory for this contract
    mkdir -p temp_opt
    cp -r contracts/$contract temp_opt/
    
    # Run optimizer on the temporary directory
    docker run --rm \
        -v "$(pwd)/temp_opt/$contract":/code \
        cosmwasm/optimizer:0.15.1 || echo "Failed to optimize $contract"
    
    # Copy the optimized artifact if it exists
    if [ -f "temp_opt/$contract/artifacts/${contract//_/-}.wasm" ]; then
        cp "temp_opt/$contract/artifacts/${contract//_/-}.wasm" "artifacts/cosmos_$contract.wasm"
    elif [ -f "temp_opt/$contract/artifacts/cosmos_${contract}.wasm" ]; then
        cp "temp_opt/$contract/artifacts/cosmos_${contract}.wasm" "artifacts/"
    else
        echo "Warning: Could not find optimized artifact for $contract"
    fi
done

# Clean up
rm -rf temp_opt

echo "Optimization complete!"
ls -la artifacts/