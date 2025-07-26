import { CardanoFusionClient } from '../src/cardano-fusion-client-mock';
import * as dotenv from 'dotenv';

dotenv.config();

async function testHTLCFlow() {
  console.log('🧪 Testing Cardano HTLC Flow\n');

  try {
    // Initialize client
    const client = new CardanoFusionClient(
      'https://cardano-preprod.blockfrost.io/api/v0',
      'mock-api-key',
      'Preprod'
    );
    
    await client.init();
    
    const walletAddress = await client.getWalletAddress();
    const initialBalance = await client.getBalance();
    
    console.log('Initial Balance:', CardanoFusionClient.lovelaceToAda(initialBalance), 'ADA\n');

    // Test 1: Create HTLC
    console.log('=== Test 1: Create HTLC ===');
    const { secret, secretHash } = CardanoFusionClient.generateSecret();
    const timeout = CardanoFusionClient.calculateTimelock(3600); // 1 hour
    
    const htlcTxHash = await client.createHTLC({
      secretHash,
      recipient: walletAddress,
      sender: walletAddress,
      amount: CardanoFusionClient.adaToLovelace(10),
      timeout,
      minPartialAmount: CardanoFusionClient.adaToLovelace(2),
    });

    const balanceAfterCreate = await client.getBalance();
    console.log('Balance after creation:', CardanoFusionClient.lovelaceToAda(balanceAfterCreate), 'ADA\n');

    // Test 2: Get HTLC State
    console.log('=== Test 2: Get HTLC State ===');
    const htlcState = await client.getHTLCState(htlcTxHash);
    if (htlcState) {
      console.log('HTLC found!');
      console.log('- Amount:', CardanoFusionClient.lovelaceToAda(htlcState.value), 'ADA');
      console.log('- Claimed:', htlcState.claimed);
      console.log('- Refunded:', htlcState.refunded);
    }

    // Test 3: Partial Claim
    console.log('\n=== Test 3: Partial Claim ===');
    const partialAmount = CardanoFusionClient.adaToLovelace(3);
    const partialClaimTx = await client.claimPartialHTLC(htlcTxHash, secret, partialAmount);
    
    const stateAfterPartial = await client.getHTLCState(htlcTxHash);
    if (stateAfterPartial) {
      console.log('Remaining in HTLC:', CardanoFusionClient.lovelaceToAda(stateAfterPartial.value), 'ADA');
    }

    // Test 4: Full Claim of Remaining
    console.log('\n=== Test 4: Claim Remaining ===');
    const fullClaimTx = await client.claimHTLC(htlcTxHash, secret);
    
    const finalState = await client.getHTLCState(htlcTxHash);
    if (finalState) {
      console.log('Final state - Claimed:', finalState.claimed);
    }

    // Test 5: Test Refund (with expired HTLC)
    console.log('\n=== Test 5: Test Refund ===');
    const expiredTimeout = Date.now() - 1000; // Already expired
    
    const expiredHTLCTx = await client.createHTLC({
      secretHash: CardanoFusionClient.generateSecret().secretHash,
      recipient: walletAddress,
      sender: walletAddress,
      amount: CardanoFusionClient.adaToLovelace(5),
      timeout: expiredTimeout,
    });

    try {
      await client.refundHTLC(expiredHTLCTx);
      console.log('Refund successful!');
    } catch (error: any) {
      console.log('Refund result:', error.message);
    }

    // Final balance
    const finalBalance = await client.getBalance();
    console.log('\n💰 Final Balance:', CardanoFusionClient.lovelaceToAda(finalBalance), 'ADA');

    console.log('\n✅ All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run tests
testHTLCFlow().catch(console.error);