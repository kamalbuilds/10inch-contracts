#!/bin/bash

echo "🚀 Deploying test token on Stellar testnet..."

# Deploy SAC (Stellar Asset Contract) for native XLM
TOKEN_ID=$(stellar contract asset deploy \
  --asset native \
  --source deployer \
  --network testnet)

echo "✅ Test token deployed: $TOKEN_ID"
echo ""
echo "To use this token in tests, update the token address to: $TOKEN_ID"