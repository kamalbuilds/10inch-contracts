#!/bin/bash

echo "🔄 Completing Sepolia to Stellar swap..."
echo ""

# From the test output
HASHLOCK="89f38a8ba4844affbb3c822c718e0906ed098bdfb2a5a9ca8c87f98c1dc61870"
SECRET="900f54db27e85e684e79d3c9dc30cae0c07529a42d0f4c5985089c6cd2fd9a8d"
STELLAR_HTLC="CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V"

echo "📝 Creating corresponding HTLC on Stellar..."
echo "Hashlock: $HASHLOCK"
echo ""

# Create HTLC on Stellar
stellar contract invoke \
  --id $STELLAR_HTLC \
  --source deployer \
  --network testnet \
  -- create_htlc \
  --sender GAD5WVZJM3LQDORES47DEDS4DS5GFE4AWBXWFQ6DBLZT5YMMZKHXZKXM \
  --receiver GAD5WVZJM3LQDORES47DEDS4DS5GFE4AWBXWFQ6DBLZT5YMMZKHXZKXM \
  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --amount 100000000 \
  --hashlock $HASHLOCK \
  --timelock $(($(date +%s) + 1800))

echo ""
echo "✅ HTLC created on Stellar!"
echo ""
echo "To complete the swap, the user can withdraw from Stellar using:"
echo "stellar contract invoke --id $STELLAR_HTLC --source deployer --network testnet -- withdraw --htlc_id 2 --secret $SECRET"