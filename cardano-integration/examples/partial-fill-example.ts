import { CardanoFusionClient } from '../src/cardano-fusion-client-mock';
import * as dotenv from 'dotenv';

dotenv.config();

async function demonstratePartialFills() {
  console.log('🔄 Demonstrating Partial Fill Support on Cardano\n');

  try {
    // Initialize client
    const client = new CardanoFusionClient(
      process.env.BLOCKFROST_URL || 'https://cardano-preprod.blockfrost.io/api/v0',
      process.env.BLOCKFROST_API_KEY!,
      'Preprod'
    );
    
    await client.init(process.env.CARDANO_SEED_PHRASE);
    
    // Create a large HTLC that can be partially filled
    console.log('📝 Creating HTLC with partial fill support...');
    
    const { secret, secretHash } = CardanoFusionClient.generateSecret();
    const totalAmount = CardanoFusionClient.adaToLovelace(10); // 10 ADA
    const minPartialAmount = CardanoFusionClient.adaToLovelace(1); // Min 1 ADA per fill
    
    const txHash = await client.createHTLC({
      secretHash,
      recipient: await client.getWalletAddress(),
      sender: await client.getWalletAddress(),
      amount: totalAmount,
      timeout: CardanoFusionClient.calculateTimelock(3600),
      minPartialAmount,
    });

    console.log('✅ HTLC created with:');
    console.log('- Total amount: 10 ADA');
    console.log('- Min partial fill: 1 ADA');
    console.log('- Transaction:', txHash);

    // Wait for confirmation (in production, use proper confirmation logic)
    console.log('\n⏳ Waiting for confirmation...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds

    // Get HTLC state
    const htlcState = await client.getHTLCState(txHash, 0);
    if (!htlcState) {
      console.error('❌ HTLC not found');
      return;
    }

    // Claim partial amount (3 ADA)
    console.log('\n💰 Claiming partial amount: 3 ADA');
    const partialAmount = CardanoFusionClient.adaToLovelace(3);
    
    const claimTx = await client.claimPartialHTLC(
      htlcState.utxo as any, // Type casting for demo
      secret,
      partialAmount
    );

    console.log('✅ Partial claim successful!');
    console.log('- Claimed: 3 ADA');
    console.log('- Remaining: 7 ADA');
    console.log('- Transaction:', claimTx);

    console.log('\n📊 Partial Fill Benefits:');
    console.log('1. Large orders can be filled by multiple parties');
    console.log('2. Improved liquidity utilization');
    console.log('3. Reduced slippage for large trades');
    console.log('4. Better price discovery');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run demonstration
demonstratePartialFills().catch(console.error);