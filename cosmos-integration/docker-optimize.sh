#!/bin/bash

echo "Checking if Docker is running..."
if ! docker info > /dev/null 2>&1; then
    echo "Docker is not running. Please start Docker and try again."
    echo "On macOS: Open Docker Desktop from Applications"
    exit 1
fi

echo "Optimizing CosmWasm contracts with Docker..."

# Create artifacts directory
mkdir -p artifacts

# Run the optimizer
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/optimizer:0.15.1

echo "Optimization complete!"
ls -la artifacts/