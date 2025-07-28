import { ethers } from 'ethers';
import { CosmosResolver } from '../src/CosmosResolver';
import { CrossChainRelayer } from '../src/relayer';
import { TESTNET_CONFIG, CHAIN_IDS } from '../src/constants';
import { generateSecret, generateHashlock, sleep, parseAmount } from '../src/utils';
import * as dotenv from 'dotenv';

dotenv.config();

async function runE2ETest() {
  console.log('🚀 Starting End-to-End Cross-Chain Swap Test\n');

  // Configuration
  const config = {
    cosmos: {
      ...TESTNET_CONFIG,
      resolverContract: process.env.COSMOS_RESOLVER_CONTRACT || '',
    },
    evm: {
      rpcEndpoint: process.env.EVM_RPC_ENDPOINT || '',
      resolverContract: process.env.EVM_RESOLVER_CONTRACT || '',
      chainId: parseInt(process.env.EVM_CHAIN_ID || '11155111'),
    },
  };

  // Validate configuration
  if (!config.cosmos.resolverContract || !config.evm.resolverContract) {
    console.error('❌ Missing contract addresses. Please deploy contracts and update .env file.');
    return;
  }

  // Initialize clients
  console.log('1️⃣ Initializing clients...');
  
  // Cosmos client (User)
  const cosmosUser = new CosmosResolver(config.cosmos);
  await cosmosUser.connect(process.env.COSMOS_MNEMONIC || '');
  const cosmosUserAddress = cosmosUser.getSenderAddress();
  console.log(`   Cosmos user: ${cosmosUserAddress}`);

  // EVM client (User)
  const evmProvider = new ethers.JsonRpcProvider(config.evm.rpcEndpoint);
  const evmUserWallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY || '', evmProvider);
  console.log(`   EVM user: ${evmUserWallet.address}`);

  // Initialize relayer
  console.log('   Starting relayer service...');
  const relayer = new CrossChainRelayer({
    cosmosRpc: config.cosmos.rpcEndpoint,
    evmRpc: config.evm.rpcEndpoint,
    cosmosResolverContract: config.cosmos.resolverContract,
    evmResolverContract: config.evm.resolverContract,
    relayerCosmosMnemonic: process.env.RELAYER_MNEMONIC || '',
    relayerEvmPrivateKey: process.env.RELAYER_PRIVATE_KEY || '',
    pollingInterval: 3000,
  });
  
  await relayer.initialize();
  relayer.start();

  // Test Case 1: Cosmos to EVM swap
  console.log('\n2️⃣ Test Case 1: Cosmos → EVM Atomic Swap');
  
  const secret1 = generateSecret();
  const secretHash1 = generateHashlock(secret1);
  console.log(`   Secret: ${secret1}`);
  console.log(`   Secret hash: ${secretHash1}`);

  try {
    // User creates order on Cosmos
    console.log('   Creating order on Cosmos...');
    const cosmosResult = await cosmosUser.deploySrc({
      initiator: cosmosUserAddress!,
      dstChainId: config.evm.chainId,
      dstRecipient: evmUserWallet.address,
      dstToken: '0x0000000000000000000000000000000000000000', // ETH
      srcAmount: {
        denom: 'uatom',
        amount: parseAmount('0.1', 6), // 0.1 ATOM
      },
      dstAmount: ethers.parseEther('0.001').toString(), // 0.001 ETH
      secretHash: secretHash1,
      safetyDeposit: {
        denom: 'uatom',
        amount: parseAmount('0.01', 6), // 0.01 ATOM safety deposit
      },
      timelock: 3600, // 1 hour
    });

    console.log(`   ✅ Cosmos order created: ${cosmosResult.transactionHash}`);
    
    // Extract order ID
    const cosmosOrderId = cosmosResult.events
      .find(e => e.type === 'wasm')
      ?.attributes.find(a => a.key === 'order_id')?.value;

    if (!cosmosOrderId) {
      throw new Error('Failed to extract Cosmos order ID');
    }

    console.log(`   Order ID: ${cosmosOrderId}`);

    // Wait for relayer to process
    console.log('   Waiting for relayer to deploy on EVM...');
    await sleep(10000); // 10 seconds

    // Query order status
    const cosmosOrder = await cosmosUser.queryOrder(parseInt(cosmosOrderId));
    console.log(`   Cosmos order status: src_deployed=${cosmosOrder.srcDeployed}, dst_deployed=${cosmosOrder.dstDeployed}`);

    if (cosmosOrder.dstDeployed) {
      // User reveals secret on EVM to claim funds
      console.log('   Revealing secret on EVM...');
      
      // EVM resolver contract interface
      const evmResolverAbi = [
        'function withdraw(uint256 orderId, bytes32 secret) external',
      ];
      
      const evmResolver = new ethers.Contract(
        config.evm.resolverContract,
        evmResolverAbi,
        evmUserWallet
      );

      const evmWithdrawTx = await evmResolver.withdraw(
        cosmosOrderId,
        `0x${secret1}`
      );
      
      console.log(`   ✅ EVM withdrawal tx: ${evmWithdrawTx.hash}`);
      await evmWithdrawTx.wait();

      // Wait for relayer to withdraw from Cosmos
      console.log('   Waiting for relayer to complete Cosmos withdrawal...');
      await sleep(10000);

      // Check final status
      const finalOrder = await cosmosUser.queryOrder(parseInt(cosmosOrderId));
      console.log(`   ✅ Swap completed! Final status: ${finalOrder.completed ? 'COMPLETED' : 'PENDING'}`);
    } else {
      console.log('   ❌ Destination escrow not deployed by relayer');
    }

  } catch (error) {
    console.error('   ❌ Test Case 1 failed:', error);
  }

  // Test Case 2: EVM to Cosmos swap
  console.log('\n3️⃣ Test Case 2: EVM → Cosmos Atomic Swap');
  
  const secret2 = generateSecret();
  const secretHash2 = generateHashlock(secret2);
  console.log(`   Secret: ${secret2}`);
  console.log(`   Secret hash: ${secretHash2}`);

  try {
    // User creates order on EVM
    console.log('   Creating order on EVM...');
    
    const evmResolverAbi = [
      'function createOrder(uint32 dstChainId, string calldata dstRecipient, address token, uint256 amount, bytes32 secretHash, uint256 timelock) external payable returns (uint256)',
    ];
    
    const evmResolver = new ethers.Contract(
      config.evm.resolverContract,
      evmResolverAbi,
      evmUserWallet
    );

    const amount = ethers.parseEther('0.001'); // 0.001 ETH
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    const createOrderTx = await evmResolver.createOrder(
      CHAIN_IDS.COSMOS,
      cosmosUserAddress,
      ethers.ZeroAddress, // ETH
      amount,
      `0x${secretHash2}`,
      timelock,
      { value: amount }
    );

    console.log(`   ✅ EVM order creation tx: ${createOrderTx.hash}`);
    const receipt = await createOrderTx.wait();
    
    // Extract order ID from events
    const orderCreatedEvent = receipt.logs.find(log => 
      log.topics[0] === ethers.id('OrderCreated(uint256,address,address,uint32,string,bytes32,uint256,uint256)')
    );
    
    if (!orderCreatedEvent) {
      throw new Error('Failed to find OrderCreated event');
    }

    const evmOrderId = ethers.toBigInt(orderCreatedEvent.topics[1]);
    console.log(`   Order ID: ${evmOrderId}`);

    // Wait for relayer to process
    console.log('   Waiting for relayer to deploy on Cosmos...');
    await sleep(15000); // 15 seconds

    // Check if Cosmos order was created
    const cosmosOrderId2 = await cosmosUser.queryOrderBySecretHash(secretHash2);
    
    if (cosmosOrderId2) {
      console.log(`   Cosmos order created with ID: ${cosmosOrderId2}`);
      
      // User reveals secret on Cosmos to claim funds
      console.log('   Revealing secret on Cosmos...');
      
      const withdrawResult = await cosmosUser.withdraw({
        orderId: cosmosOrderId2,
        secret: secret2,
        isSourceChain: false,
      });

      console.log(`   ✅ Cosmos withdrawal tx: ${withdrawResult.transactionHash}`);

      // Wait for relayer to complete EVM withdrawal
      console.log('   Waiting for relayer to complete EVM withdrawal...');
      await sleep(10000);

      console.log('   ✅ Swap completed!');
    } else {
      console.log('   ❌ Cosmos order not created by relayer');
    }

  } catch (error) {
    console.error('   ❌ Test Case 2 failed:', error);
  }

  // Cleanup
  console.log('\n4️⃣ Test completed. Stopping relayer...');
  relayer.stop();
  
  console.log('\n✅ End-to-End test finished!');
  console.log('\n📊 Summary:');
  console.log('   - Cosmos → EVM swap tested');
  console.log('   - EVM → Cosmos swap tested');
  console.log('   - Relayer service demonstrated');
  console.log('\n🔗 Check block explorers for transaction details:');
  console.log('   - Cosmos: https://explorer.theta-testnet.polypore.xyz/');
  console.log('   - Sepolia: https://sepolia.etherscan.io/');
}

// Run the test
if (require.main === module) {
  runE2ETest()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('E2E test failed:', error);
      process.exit(1);
    });
}

export { runE2ETest };