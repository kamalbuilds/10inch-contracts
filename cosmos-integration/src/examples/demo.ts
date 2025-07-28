import { CosmosAtomicSwap } from '../CosmosAtomicSwap';
import { TESTNET_CONFIG, CHAIN_IDS } from '../constants';
import { generateSecret, generateHashlock, sleep } from '../utils';

async function demonstrateAtomicSwap() {
  console.log('🚀 1inch Fusion+ Cosmos Integration Demo\n');

  // Initialize client
  const config = {
    ...TESTNET_CONFIG,
    atomicSwapContract: 'cosmos1atomicswap...', // Replace with actual contract address
    bridgeContract: 'cosmos1bridge...', // Replace with actual contract address
  };

  const client = new CosmosAtomicSwap(config);

  // Connect with mnemonic (in production, use secure key management)
  const mnemonic = process.env.COSMOS_MNEMONIC || 'your test mnemonic here';
  await client.connect(mnemonic);

  const senderAddress = client.getSenderAddress();
  console.log(`Connected with address: ${senderAddress}\n`);

  // Example 1: Create an Atomic Swap
  console.log('=== Example 1: Atomic Swap ===');
  
  const secret = client.generateSecret();
  const secretHash = client.generateHashlock(secret);
  
  console.log(`Generated secret: ${secret}`);
  console.log(`Secret hash: ${secretHash}\n`);

  try {
    console.log('Creating atomic swap...');
    const createSwapResult = await client.createSwap({
      recipient: 'cosmos1recipient...', // Replace with actual recipient
      secretHash,
      timelock: 7200, // 2 hours
      amount: {
        denom: 'uatom',
        amount: '1000000', // 1 ATOM
      },
    });

    console.log(`Swap created! TX: ${createSwapResult.transactionHash}`);
    console.log(`Gas used: ${createSwapResult.gasUsed}`);

    // Extract swap ID from events
    const swapId = createSwapResult.events
      .find(e => e.type === 'wasm')
      ?.attributes.find(a => a.key === 'swap_id')?.value;

    if (swapId) {
      console.log(`Swap ID: ${swapId}\n`);

      // Query swap details
      const swap = await client.querySwap(swapId);
      console.log('Swap details:', JSON.stringify(swap, null, 2));

      // Complete the swap
      console.log('\nCompleting swap...');
      const completeResult = await client.completeSwap({
        swapId,
        secret,
      });

      console.log(`Swap completed! TX: ${completeResult.transactionHash}\n`);
    }
  } catch (error) {
    console.error('Atomic swap error:', error);
  }

  // Example 2: Cross-Chain Bridge Order
  console.log('\n=== Example 2: Cross-Chain Bridge Order ===');

  const bridgeSecret = client.generateSecret();
  const bridgeSecretHash = client.generateHashlock(bridgeSecret);

  try {
    console.log('Creating bridge order to Ethereum...');
    const createOrderResult = await client.createBridgeOrder({
      targetChainId: CHAIN_IDS.ETHEREUM,
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278d', // Example Ethereum address
      secretHash: bridgeSecretHash,
      timelock: 3600, // 1 hour
      amount: {
        denom: 'uatom',
        amount: '5000000', // 5 ATOM
      },
    });

    console.log(`Bridge order created! TX: ${createOrderResult.transactionHash}`);

    // Extract order ID from events
    const orderId = createOrderResult.events
      .find(e => e.type === 'wasm')
      ?.attributes.find(a => a.key === 'order_id')?.value;

    if (orderId) {
      console.log(`Order ID: ${orderId}\n`);

      // Query order details
      const order = await client.queryBridgeOrder(orderId);
      console.log('Bridge order details:', JSON.stringify(order, null, 2));

      // In a real scenario, the counterparty would complete the order
      // For demo purposes, we'll show how to complete it
      console.log('\nCompleting bridge order...');
      const completeOrderResult = await client.completeBridgeOrder({
        orderId,
        secret: bridgeSecret,
      });

      console.log(`Bridge order completed! TX: ${completeOrderResult.transactionHash}\n`);
    }
  } catch (error) {
    console.error('Bridge order error:', error);
  }

  // Example 3: Query Chain Configuration
  console.log('\n=== Example 3: Query Configurations ===');

  try {
    // Query atomic swap config
    const atomicSwapConfig = await client.queryAtomicSwapConfig();
    console.log('Atomic Swap Config:', JSON.stringify(atomicSwapConfig, null, 2));

    // Query bridge config
    const bridgeConfig = await client.queryBridgeConfig();
    console.log('\nBridge Config:', JSON.stringify(bridgeConfig, null, 2));

    // Query chain configs
    const ethereumConfig = await client.queryChainConfig(CHAIN_IDS.ETHEREUM);
    console.log('\nEthereum Chain Config:', JSON.stringify(ethereumConfig, null, 2));
  } catch (error) {
    console.error('Config query error:', error);
  }

  // Example 4: Refund Expired Swap
  console.log('\n=== Example 4: Refund Expired Swap ===');

  try {
    // Create a swap with short timelock for demo
    const refundSecret = client.generateSecret();
    const refundSecretHash = client.generateHashlock(refundSecret);

    console.log('Creating swap with 10-second timelock...');
    const shortTimelockResult = await client.createSwap({
      recipient: 'cosmos1recipient...',
      secretHash: refundSecretHash,
      timelock: 10, // Very short for demo
      amount: {
        denom: 'uatom',
        amount: '100000', // 0.1 ATOM
      },
    });

    const refundSwapId = shortTimelockResult.events
      .find(e => e.type === 'wasm')
      ?.attributes.find(a => a.key === 'swap_id')?.value;

    if (refundSwapId) {
      console.log(`Swap created with ID: ${refundSwapId}`);
      console.log('Waiting for timelock to expire...');
      
      await sleep(11000); // Wait 11 seconds

      console.log('Refunding expired swap...');
      const refundResult = await client.refundSwap(refundSwapId);
      console.log(`Swap refunded! TX: ${refundResult.transactionHash}`);
    }
  } catch (error) {
    console.error('Refund error:', error);
  }

  console.log('\n✅ Demo completed!');
}

// Run the demo
if (require.main === module) {
  demonstrateAtomicSwap()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Demo failed:', error);
      process.exit(1);
    });
}

export { demonstrateAtomicSwap };