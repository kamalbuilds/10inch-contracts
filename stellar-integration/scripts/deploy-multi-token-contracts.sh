#!/bin/bash

echo "🚀 Deploying Multi-Token HTLC Contracts..."
echo ""

# Deploy Stellar Multi-Token HTLC
echo "📦 Building Stellar Multi-Token HTLC..."
cd contracts/multi-token-htlc
cargo build --release --target wasm32-unknown-unknown
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/multi_token_htlc.wasm

echo ""
echo "🌟 Deploying to Stellar testnet..."
STELLAR_MULTI_TOKEN_HTLC=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/multi_token_htlc.optimized.wasm \
  --source deployer \
  --network testnet)

echo "✅ Stellar Multi-Token HTLC deployed: $STELLAR_MULTI_TOKEN_HTLC"

# Initialize the contract
echo "🔧 Initializing Stellar contract..."
stellar contract invoke \
  --id $STELLAR_MULTI_TOKEN_HTLC \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin $(stellar keys address deployer)

# Add supported tokens
echo "➕ Adding supported tokens..."

# Add native XLM
stellar contract invoke \
  --id $STELLAR_MULTI_TOKEN_HTLC \
  --source deployer \
  --network testnet \
  -- add_token \
  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --symbol XLM \
  --decimals 7 \
  --min_amount 1000000 \
  --max_amount 1000000000000

# Add USDC (example)
stellar contract invoke \
  --id $STELLAR_MULTI_TOKEN_HTLC \
  --source deployer \
  --network testnet \
  -- add_token \
  --token CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75 \
  --symbol USDC \
  --decimals 7 \
  --min_amount 1000000 \
  --max_amount 100000000000

cd ../..

# Save deployment info
cat > multi-token-deployment.json << EOF
{
  "stellar": {
    "network": "testnet",
    "multiTokenHTLC": "$STELLAR_MULTI_TOKEN_HTLC",
    "supportedTokens": [
      {
        "symbol": "XLM",
        "address": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        "decimals": 7
      },
      {
        "symbol": "USDC",
        "address": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
        "decimals": 7
      }
    ],
    "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  },
  "evm": {
    "note": "Deploy MultiTokenHTLC.sol to your EVM chains and update this section"
  }
}
EOF

echo ""
echo "✅ Multi-token contracts deployed!"
echo "📄 Deployment info saved to multi-token-deployment.json"
echo ""
echo "Next steps:"
echo "1. Deploy MultiTokenHTLC.sol to EVM chains"
echo "2. Update multi-token-deployment.json with EVM addresses"
echo "3. Configure resolver service with new contract addresses"