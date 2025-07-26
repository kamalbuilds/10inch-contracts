import { CardanoFusionClient } from '../src/cardano-fusion-client-mock';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function deployToTestnet() {
  console.log('🚀 Deploying Cardano HTLC to Preprod testnet...\n');

  try {
    // Configuration
    const blockfrostUrl = process.env.BLOCKFROST_URL || 'https://cardano-preprod.blockfrost.io/api/v0';
    const blockfrostApiKey = process.env.BLOCKFROST_API_KEY;
    
    if (!blockfrostApiKey) {
      console.error('❌ Please set BLOCKFROST_API_KEY in .env file');
      console.log('Get your API key from: https://blockfrost.io');
      return;
    }

    // Initialize client
    console.log('📱 Initializing Cardano client...');
    const client = new CardanoFusionClient(blockfrostUrl, blockfrostApiKey, 'Preprod');
    
    // Use existing seed or generate new one
    const seedPhrase = process.env.CARDANO_SEED_PHRASE;
    await client.init(seedPhrase);
    
    const walletAddress = await client.getWalletAddress();
    const balance = await client.getBalance();
    
    console.log('Wallet Address:', walletAddress);
    console.log('Balance:', CardanoFusionClient.lovelaceToAda(balance), 'ADA');
    
    if (balance < CardanoFusionClient.adaToLovelace(10)) {
      console.log('\n⚠️  Low balance detected. You need test ADA to deploy.');
      console.log('Get test ADA from: https://docs.cardano.org/cardano-testnets/tools/faucet/');
      return;
    }

    // Get HTLC script address
    const htlcAddress = client.getHTLCAddress();
    console.log('\n📋 HTLC Script Address:', htlcAddress);

    // Save deployment info
    const deploymentInfo = {
      network: 'preprod',
      htlcAddress,
      walletAddress,
      deployedAt: new Date().toISOString(),
      blockfrostUrl,
    };

    const deploymentPath = path.join(__dirname, '..', 'deployment-preprod.json');
    fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
    
    console.log('\n✅ Deployment info saved to:', deploymentPath);

    // Create a test HTLC to verify it works
    console.log('\n🧪 Creating test HTLC...');
    
    const { secret, secretHash } = CardanoFusionClient.generateSecret();
    const timeout = CardanoFusionClient.calculateTimelock(3600); // 1 hour
    
    const txHash = await client.createHTLC({
      secretHash,
      recipient: walletAddress, // Send to ourselves for testing
      sender: walletAddress,
      amount: CardanoFusionClient.adaToLovelace(2),
      timeout,
      minPartialAmount: CardanoFusionClient.adaToLovelace(0.5),
    });

    console.log('✅ Test HTLC created!');
    console.log('Transaction hash:', txHash);
    console.log('Secret:', secret);
    console.log('Secret hash:', secretHash);
    
    // Save test data
    const testData = {
      txHash,
      secret,
      secretHash,
      timeout,
      amount: '2 ADA',
    };
    
    fs.writeFileSync(
      path.join(__dirname, '..', 'test-htlc.json'),
      JSON.stringify(testData, null, 2)
    );

    console.log('\n🎉 Deployment complete!');
    console.log('Test HTLC data saved to: test-htlc.json');
    console.log('\nNext steps:');
    console.log('1. Wait for transaction confirmation (~20 seconds)');
    console.log('2. Run test scripts to verify functionality');
    console.log('3. Set up cross-chain relayer service');

  } catch (error) {
    console.error('❌ Deployment failed:', error);
  }
}

// Run deployment
deployToTestnet().catch(console.error);