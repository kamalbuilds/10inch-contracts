#!/bin/bash

# Optimize CosmWasm contracts for deployment
echo "Optimizing CosmWasm contracts..."

# Create optimized directory
mkdir -p optimized

# Optimize each contract
for contract in atomic_swap cross_chain_bridge resolver; do
    echo "Optimizing $contract..."
    docker run --rm -v "$(pwd)":/code \
      --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
      --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
      cosmwasm/optimizer:0.15.1 ./contracts/$contract
done

echo "Optimization complete!"
echo "Optimized contracts are in the ./artifacts directory"