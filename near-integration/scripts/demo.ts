import { NearFusionClient } from '../src/fusion-client';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

async function demonstrateSwaps() {
  console.log('🚀 1inch Fusion+ NEAR Integration Demo\n');

  // Initialize client
  const client = new NearFusionClient();
  await client.initialize({
    nearNetwork: 'testnet',
    nearAccountId: process.env.NEAR_ACCOUNT_ID,
    nearPrivateKey: process.env.NEAR_PRIVATE_KEY,
    evmRpcUrls: {
      ethereum: process.env.ETH_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_KEY',
      bsc: process.env.BSC_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      polygon: process.env.POLYGON_RPC_URL || 'https://rpc-mumbai.maticvigil.com/',
    },
  });

  console.log('✅ Client initialized\n');

  // Demo 1: NEAR to Ethereum swap
  await demoNearToEthSwap(client);

  // Demo 2: Ethereum to NEAR swap
  await demoEthToNearSwap(client);

  // Demo 3: Token swap (USDC on Ethereum to USDC on NEAR)
  await demoTokenSwap(client);
}

async function demoNearToEthSwap(client: NearFusionClient) {
  console.log('📤 Demo 1: NEAR → Ethereum Swap');
  console.log('================================\n');

  const swapParams = {
    direction: 'NEAR_TO_EVM' as const,
    srcChain: 'NEAR',
    dstChain: 'ethereum',
    srcToken: 'NEAR',
    dstToken: ethers.ZeroAddress, // ETH
    amount: '1', // 1 NEAR
    sender: process.env.NEAR_ACCOUNT_ID || 'sender.testnet',
    receiver: process.env.ETH_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f6E789',
    slippage: 100, // 1%
  };

  console.log('Swap parameters:');
  console.log(`  From: ${swapParams.amount} NEAR on NEAR Protocol`);
  console.log(`  To: ETH on Ethereum`);
  console.log(`  Receiver: ${swapParams.receiver}\n`);

  // Estimate fees
  const fees = await client.estimateFee(swapParams);
  console.log('Fee estimation:');
  console.log(`  Protocol fee: ${ethers.formatEther(fees.protocolFee)} NEAR`);
  console.log(`  Network fee: ${ethers.formatEther(fees.networkFee)} NEAR`);
  console.log(`  Total fee: ${ethers.formatEther(fees.totalFee)} NEAR\n`);

  try {
    // Create swap
    console.log('Creating swap...');
    const swap = await client.createSwap(swapParams);
    
    console.log('✅ Swap created!');
    console.log(`  Swap ID: ${swap.swapId}`);
    console.log(`  Secret hash: ${swap.secretHash}`);
    console.log(`  NEAR TX: ${swap.srcTxHash}`);
    console.log(`  Status: ${swap.status}`);
    console.log(`  Expires at: ${new Date(swap.expiryTime * 1000).toLocaleString()}\n`);

    // In real scenario, the resolver would:
    // 1. Monitor the NEAR HTLC
    // 2. Create corresponding escrow on Ethereum
    // 3. Wait for user to claim on Ethereum with secret
    // 4. Use revealed secret to claim on NEAR

    console.log('💡 Next steps:');
    console.log('  1. Resolver creates escrow on Ethereum');
    console.log('  2. You claim ETH by revealing secret');
    console.log('  3. Resolver claims NEAR using revealed secret\n');

  } catch (error) {
    console.error('❌ Swap failed:', error);
  }

  console.log('');
}

async function demoEthToNearSwap(client: NearFusionClient) {
  console.log('📥 Demo 2: Ethereum → NEAR Swap');
  console.log('================================\n');

  const swapParams = {
    direction: 'EVM_TO_NEAR' as const,
    srcChain: 'ethereum',
    dstChain: 'NEAR',
    srcToken: ethers.ZeroAddress, // ETH
    dstToken: 'NEAR',
    amount: '0.1', // 0.1 ETH
    sender: process.env.ETH_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f6E789',
    receiver: process.env.NEAR_ACCOUNT_ID || 'receiver.testnet',
    slippage: 100,
  };

  console.log('Swap parameters:');
  console.log(`  From: ${swapParams.amount} ETH on Ethereum`);
  console.log(`  To: NEAR on NEAR Protocol`);
  console.log(`  Receiver: ${swapParams.receiver}\n`);

  // Estimate fees
  const fees = await client.estimateFee(swapParams);
  console.log('Fee estimation:');
  console.log(`  Protocol fee: ${ethers.formatEther(fees.protocolFee)} ETH`);
  console.log(`  Network fee: ${ethers.formatEther(fees.networkFee)} ETH`);
  console.log(`  Total fee: ${ethers.formatEther(fees.totalFee)} ETH\n`);

  console.log('💡 To execute this swap:');
  console.log('  1. Connect MetaMask to initiate');
  console.log('  2. Create escrow on Ethereum');
  console.log('  3. Resolver creates HTLC on NEAR');
  console.log('  4. Claim NEAR with secret\n');
}

async function demoTokenSwap(client: NearFusionClient) {
  console.log('💱 Demo 3: USDC Cross-Chain Swap');
  console.log('=================================\n');

  const swapParams = {
    direction: 'EVM_TO_NEAR' as const,
    srcChain: 'ethereum',
    dstChain: 'NEAR',
    srcToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
    dstToken: 'usdc.near', // USDC on NEAR
    amount: '100', // 100 USDC
    sender: process.env.ETH_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc9e7595f6E789',
    receiver: process.env.NEAR_ACCOUNT_ID || 'receiver.testnet',
    slippage: 50, // 0.5%
  };

  console.log('Swap parameters:');
  console.log(`  From: ${swapParams.amount} USDC on Ethereum`);
  console.log(`  To: USDC on NEAR Protocol`);
  console.log(`  Max slippage: ${swapParams.slippage / 100}%\n`);

  // Get supported tokens
  console.log('Supported tokens on NEAR:');
  const nearTokens = await client.getSupportedTokens('NEAR');
  nearTokens.forEach(token => {
    console.log(`  - ${token.symbol} (${token.address})`);
  });

  console.log('\nSupported tokens on Ethereum:');
  const ethTokens = await client.getSupportedTokens('ethereum');
  ethTokens.forEach(token => {
    console.log(`  - ${token.symbol} (${token.address})`);
  });
  
  console.log('');
}

// Run demo
demonstrateSwaps()
  .then(() => {
    console.log('✨ Demo completed!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Demo error:', error);
    process.exit(1);
  });