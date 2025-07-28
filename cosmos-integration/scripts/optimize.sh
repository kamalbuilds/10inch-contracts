#!/bin/bash

set -e

echo "Optimizing CosmWasm contracts..."

# Create artifacts directory
mkdir -p artifacts

# Run optimizer
docker run --rm -v "$(pwd)":/code \
    --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
    --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
    cosmwasm/rust-optimizer:0.12.13

echo "Optimization complete! Contracts are in the artifacts/ directory"