import { CardanoFusionClient } from '../src/cardano-fusion-client-mock';
import { CardanoRelayerService } from '../src/relayer-service';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load shared HTLC deployment from main project
const sharedHTLCPath = path.join(__dirname, '../../shared-htlc-deployment.json');
const sharedDeployment = fs.existsSync(sharedHTLCPath) 
  ? JSON.parse(fs.readFileSync(sharedHTLCPath, 'utf-8'))
  : null;

async function testCrossChainSwap() {
  console.log('🔄 Testing Cardano ↔ EVM Cross-Chain Swap\n');

  try {
    // Check prerequisites
    if (!process.env.BLOCKFROST_API_KEY) {
      console.error('❌ Please set BLOCKFROST_API_KEY in .env file');
      return;
    }

    if (!process.env.EVM_PRIVATE_KEY) {
      console.error('❌ Please set EVM_PRIVATE_KEY in .env file');
      return;
    }

    // Initialize relayer service
    const relayerConfig = {
      cardano: {
        blockfrostUrl: process.env.BLOCKFROST_URL || 'https://cardano-preprod.blockfrost.io/api/v0',
        blockfrostApiKey: process.env.BLOCKFROST_API_KEY,
        network: 'Preprod' as const,
        seedPhrase: process.env.CARDANO_SEED_PHRASE || '',
      },
      evm: {
        rpcUrls: {
          sepolia: process.env.EVM_RPC_URL || 'https://sepolia.drpc.org',
        },
        privateKey: process.env.EVM_PRIVATE_KEY,
        htlcAddresses: {
          sepolia: sharedDeployment?.sepolia?.contractAddress || '',
        },
      },
    };

    console.log('📱 Initializing relayer service...');
    const relayer = new CardanoRelayerService(relayerConfig);
    await relayer.init();

    // Test 1: Cardano → EVM swap
    console.log('\n=== Test 1: Cardano → Sepolia Swap ===');
    await testCardanoToEVM(relayer);

    // Test 2: EVM → Cardano swap
    console.log('\n=== Test 2: Sepolia → Cardano Swap ===');
    await testEVMToCardano(relayer);

    console.log('\n🎉 Cross-chain swap tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

async function testCardanoToEVM(relayer: CardanoRelayerService) {
  console.log('Creating swap: 2 ADA → ETH on Sepolia');

  const swapOrder = await relayer.createCrossChainSwap({
    sourceChain: 'cardano',
    targetChain: 'ethereum',
    amount: CardanoFusionClient.adaToLovelace(2),
    recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f2Bd8e', // Example address
    timelockDuration: 3600, // 1 hour
  });

  console.log('\n📋 Swap Order Created:');
  console.log('ID:', swapOrder.id);
  console.log('Secret Hash:', swapOrder.secretHash);
  console.log('Source HTLC:', swapOrder.sourceHTLCId);
  console.log('Status:', swapOrder.status);

  // In production, the relayer would monitor and complete the swap
  console.log('\n⏳ In production, relayer would now:');
  console.log('1. Wait for Cardano HTLC confirmation');
  console.log('2. Create corresponding HTLC on Sepolia');
  console.log('3. Monitor for secret reveal');
  console.log('4. Complete the swap');
}

async function testEVMToCardano(relayer: CardanoRelayerService) {
  console.log('Creating swap: 0.001 ETH → ADA on Cardano');

  const swapOrder = await relayer.createCrossChainSwap({
    sourceChain: 'ethereum',
    targetChain: 'cardano',
    amount: ethers.parseEther('0.001'),
    recipient: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k4cwxz6jx6jwxuaac7g7g7rszkanzre7974r5ex7ep7fynxp4zzn5qfqp0xw8s9s0ncq', // Example Cardano address
    timelockDuration: 3600,
  });

  console.log('\n📋 Swap Order Created:');
  console.log('ID:', swapOrder.id);
  console.log('Secret Hash:', swapOrder.secretHash);
  console.log('Source HTLC:', swapOrder.sourceHTLCId);
  console.log('Status:', swapOrder.status);
}

// Run tests
testCrossChainSwap().catch(console.error);