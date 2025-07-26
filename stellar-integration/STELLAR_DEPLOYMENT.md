# Stellar Fusion+ Integration Deployment

## Deployment Status ✅

Successfully deployed and initialized Stellar contracts on testnet!

### Contract Addresses

- **HTLC Contract**: `CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V`
- **Relayer Contract**: `CAAMOQYTWUT5JTO3HNOO7RFCZJBKT6LMQRB7G7QP3TD627MQPHZBGUVL`

### Network Information

- **Network**: Stellar Testnet
- **Deployer**: `GAD5WVZJM3LQDORES47DEDS4DS5GFE4AWBXWFQ6DBLZT5YMMZKHXZKXM`
- **Deployed At**: 2025-07-27

### Contract Details

#### HTLC Contract
- Implements Hash Time-Locked Contracts with keccak256 compatibility
- Functions:
  - `initialize(admin)` - Initialize contract
  - `create_htlc(sender, receiver, token, amount, hashlock, timelock)` - Create new HTLC
  - `withdraw(htlc_id, secret)` - Withdraw with secret
  - `refund(htlc_id)` - Refund after timeout
  - `get_htlc(htlc_id)` - Get HTLC details

#### Relayer Contract
- Implements relayer functionality with partial order filling
- Functions:
  - `initialize(admin, htlc_contract)` - Initialize contract
  - `create_order(initiator, receiver, token, amount, hashlock, timelock, dest_chain, dest_token, safety_deposit)` - Create cross-chain order
  - `authorize_relayer(relayer)` - Authorize a relayer
  - `complete_order(order_id, secret)` - Complete order with secret
  - `cancel_order(order_id)` - Cancel expired order

### Explorer Links

- [HTLC Contract on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V)
- [Relayer Contract on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CAAMOQYTWUT5JTO3HNOO7RFCZJBKT6LMQRB7G7QP3TD627MQPHZBGUVL)

### Next Steps

1. Create test scripts for cross-chain swaps
2. Test Stellar to Ethereum Sepolia swaps
3. Test Ethereum Sepolia to Stellar swaps
4. Document test results