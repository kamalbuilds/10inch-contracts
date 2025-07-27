#!/bin/bash

# Deploy script with retry logic for XDR errors

HTLC_WASM="/Users/kamal/Desktop/1inch/stellar-integration/htlc-contract/target/wasm32-unknown-unknown/release/fusion_htlc.optimized.wasm"
RELAYER_WASM="/Users/kamal/Desktop/1inch/stellar-integration/relayer-contract/target/wasm32-unknown-unknown/release/fusion_relayer.optimized.wasm"
NETWORK="testnet"
MAX_RETRIES=5

echo "🚀 Deploying Stellar contracts with retry logic..."
echo "Max retries: $MAX_RETRIES"

# Function to deploy contract with retries
deploy_contract() {
    local wasm_path=$1
    local contract_name=$2
    local attempt=1
    
    while [ $attempt -le $MAX_RETRIES ]; do
        echo -e "\n📦 Deploying $contract_name (Attempt $attempt/$MAX_RETRIES)..."
        
        # Try to deploy
        result=$(stellar contract deploy --wasm "$wasm_path" --source deployer --network "$NETWORK" 2>&1)
        exit_code=$?
        
        if [ $exit_code -eq 0 ]; then
            # Extract contract ID from output
            contract_id=$(echo "$result" | tail -n 1)
            echo "✅ Success! $contract_name deployed at: $contract_id"
            echo "$contract_id"
            return 0
        else
            echo "❌ Attempt $attempt failed with error:"
            echo "$result" | grep -E "(error|Error)" || echo "$result"
            
            if [ $attempt -lt $MAX_RETRIES ]; then
                echo "⏳ Waiting 5 seconds before retry..."
                sleep 5
            fi
            
            ((attempt++))
        fi
    done
    
    echo "❌ Failed to deploy $contract_name after $MAX_RETRIES attempts"
    return 1
}

# Deploy HTLC contract
htlc_id=$(deploy_contract "$HTLC_WASM" "HTLC Contract")
if [ $? -ne 0 ]; then
    echo "Failed to deploy HTLC contract. Exiting."
    exit 1
fi

# Deploy Relayer contract
relayer_id=$(deploy_contract "$RELAYER_WASM" "Relayer Contract")
if [ $? -ne 0 ]; then
    echo "Failed to deploy Relayer contract. Exiting."
    exit 1
fi

echo -e "\n🎉 Deployment completed successfully!"
echo "HTLC Contract ID: $htlc_id"
echo "Relayer Contract ID: $relayer_id"

# Save deployment info
cat > stellar-deployment.json << EOF
{
  "network": "$NETWORK",
  "contracts": {
    "htlc": "$htlc_id",
    "relayer": "$relayer_id"
  },
  "deployedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo -e "\nDeployment info saved to stellar-deployment.json"