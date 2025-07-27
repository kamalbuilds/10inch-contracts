#!/bin/bash

echo "🚀 Demo: Running Resolver Service with All Features"
echo ""

# Check if Redis is running
if ! pgrep -x "redis-server" > /dev/null
then
    echo "⚠️  Redis not running. Starting Redis..."
    redis-server --daemonize yes
    sleep 2
fi

# Navigate to resolver service
cd resolver-service

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing resolver service dependencies..."
    npm install
fi

# Build the service
echo "🔨 Building resolver service..."
npm run build

# Create .env file with test configuration
cat > .env << EOF
# Network Configuration
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_HTLC_CONTRACT=CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V
STELLAR_RELAYER_CONTRACT=CAAMOQYTWUT5JTO3HNOO7RFCZJBKT6LMQRB7G7QP3TD627MQPHZBGUVL

# EVM Networks
SEPOLIA_RPC_URL=https://eth-sepolia.public.blastapi.io
SEPOLIA_HTLC_ADDRESS=0x067423CA883d8D54995735aDc1FA23c17e5b62cc

# Resolver Configuration
MIN_PROFIT_MARGIN=0.01
MAX_GAS_PRICE=100
MONITORING_INTERVAL=5000
SAFETY_DEPOSIT_MULTIPLIER=1.5

# Redis
REDIS_URL=redis://localhost:6379

# API
PORT=3000
CORS_ORIGINS=http://localhost:3000

# Logging
LOG_LEVEL=info
EOF

echo ""
echo "🌟 Starting Resolver Service..."
echo ""
echo "Features enabled:"
echo "✅ Dual-chain monitoring (Stellar + Sepolia)"
echo "✅ Multi-token support (XLM, ETH, USDC)"
echo "✅ 1inch Fusion+ integration"
echo "✅ Partial fill capability"
echo "✅ Safety deposit management"
echo ""
echo "Service will be available at: http://localhost:3000"
echo ""
echo "API Endpoints:"
echo "- GET /health - Service health check"
echo "- GET /metrics - Resolver metrics"
echo "- GET /orders - Active orders"
echo "- GET /chains - Supported chains"
echo ""
echo "Press Ctrl+C to stop the service"
echo ""

# Start the service
npm start