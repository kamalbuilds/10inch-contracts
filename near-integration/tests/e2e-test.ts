import { NearFusionSDK } from '../src/near-fusion-sdk';
import { ethers } from 'ethers';
// import { sha256 } from 'js-sha256';

// Configuration
const NEAR_CONFIG = {
  networkId: 'testnet' as const,
  contractId: 'fusion-plus.testnet',
  nodeUrl: 'https://rpc.testnet.near.org',
};

const EVM_CONFIG = {
  rpcUrl: 'https://rpc.ankr.com/eth_goerli',
  htlcAddress: '0x...', // Deployed HTLC contract on Goerli
};

// Test accounts
const NEAR_SENDER = {
  accountId: 'alice.testnet',
  privateKey: 'ed25519:...',
};

const NEAR_RECEIVER = {
  accountId: 'bob.testnet',
  privateKey: 'ed25519:...',
};

const EVM_ACCOUNT = {
  address: '0x...',
  privateKey: '0x...',
};

// End-to-end test scenarios
async function testBasicHTLC() {
  console.log('=== Testing Basic HTLC ===');
  
  // Initialize SDK
  const senderSDK = new NearFusionSDK(NEAR_CONFIG);
  await senderSDK.connect(NEAR_SENDER.accountId, NEAR_SENDER.privateKey);

  const receiverSDK = new NearFusionSDK(NEAR_CONFIG);
  await receiverSDK.connect(NEAR_RECEIVER.accountId, NEAR_RECEIVER.privateKey);

  // Create HTLC
  console.log('Creating HTLC...');
  const swap = await senderSDK.createHTLC({
    receiver: NEAR_RECEIVER.accountId,
    timelockSeconds: 3600,
    amount: NearFusionSDK.parseNearAmount('1'),
  });

  console.log(`HTLC created: ${swap.htlcId}`);
  console.log(`Secret: ${swap.secret}`);
  console.log(`Hashlock: ${swap.hashlock}`);

  // Check HTLC details
  const htlc = await senderSDK.getHTLC(swap.htlcId);
  console.log('HTLC status:', htlc?.status);

  // Receiver withdraws
  console.log('Receiver withdrawing...');
  await receiverSDK.withdrawHTLC(swap.htlcId, swap.secret);

  // Check final status
  const finalHtlc = await senderSDK.getHTLC(swap.htlcId);
  console.log('Final HTLC status:', finalHtlc?.status);
  console.log('Test completed!\n');
}

async function testPartialFills() {
  console.log('=== Testing Partial Fills ===');
  
  const senderSDK = new NearFusionSDK(NEAR_CONFIG);
  await senderSDK.connect(NEAR_SENDER.accountId, NEAR_SENDER.privateKey);

  // Create HTLC with partial fills
  console.log('Creating HTLC with partial fills enabled...');
  const swap = await senderSDK.createHTLC({
    receiver: NEAR_RECEIVER.accountId,
    timelockSeconds: 3600,
    allowPartialFills: true,
    minFillAmount: NearFusionSDK.parseNearAmount('0.1'),
    amount: NearFusionSDK.parseNearAmount('10'),
  });

  console.log(`HTLC created: ${swap.htlcId}`);

  // Create multiple partial fills
  const fillerSDK = new NearFusionSDK(NEAR_CONFIG);
  await fillerSDK.connect('filler1.testnet', 'ed25519:...');

  console.log('Creating partial fills...');
  const fill1 = await fillerSDK.createPartialFill(
    swap.htlcId,
    NearFusionSDK.parseNearAmount('3')
  );
  console.log(`Fill 1 created: ${fill1}`);

  const fill2 = await fillerSDK.createPartialFill(
    swap.htlcId,
    NearFusionSDK.parseNearAmount('2')
  );
  console.log(`Fill 2 created: ${fill2}`);

  // Check fills
  const fills = await senderSDK.getPartialFills(swap.htlcId);
  console.log(`Total fills: ${fills.length}`);

  // Receiver withdraws fills
  const receiverSDK = new NearFusionSDK(NEAR_CONFIG);
  await receiverSDK.connect(NEAR_RECEIVER.accountId, NEAR_RECEIVER.privateKey);

  console.log('Withdrawing partial fills...');
  await receiverSDK.withdrawPartialFill(swap.htlcId, fill1, swap.secret);
  await receiverSDK.withdrawPartialFill(swap.htlcId, fill2, swap.secret);

  console.log('Test completed!\n');
}

async function testCrossChainSwap() {
  console.log('=== Testing Cross-Chain Swap (NEAR -> EVM) ===');
  
  // Initialize NEAR SDK
  const nearSDK = new NearFusionSDK(NEAR_CONFIG);
  await nearSDK.connect(NEAR_SENDER.accountId, NEAR_SENDER.privateKey);

  // Initialize EVM provider
  const evmProvider = new ethers.JsonRpcProvider(EVM_CONFIG.rpcUrl);
  const evmSigner = new ethers.Wallet(EVM_ACCOUNT.privateKey, evmProvider);

  // Step 1: Create HTLC on NEAR
  console.log('Creating HTLC on NEAR...');
  const swap = await nearSDK.createSwap({
    fromChain: 'NEAR',
    toChain: 'EVM',
    fromAddress: NEAR_SENDER.accountId,
    toAddress: EVM_ACCOUNT.address,
    amount: NearFusionSDK.parseNearAmount('5'),
    timelockSeconds: 7200,
  });

  console.log(`NEAR HTLC created: ${swap.htlcId}`);
  console.log(`Hashlock: ${swap.hashlock}`);

  // Step 2: Create corresponding HTLC on EVM
  console.log('Creating corresponding HTLC on EVM...');
  const evmHTLC = new ethers.Contract(
    EVM_CONFIG.htlcAddress,
    [
      'function createHTLC(address receiver, bytes32 hashlock, uint256 timelock) payable returns (bytes32)',
    ],
    evmSigner
  );

  const evmTx = await evmHTLC.createHTLC(
    NEAR_SENDER.accountId, // Would need to convert to EVM address
    '0x' + swap.hashlock,
    Math.floor(Date.now() / 1000) + 7200,
    { value: ethers.parseEther('5') }
  );

  const receipt = await evmTx.wait();
  console.log(`EVM HTLC created in tx: ${receipt.hash}`);

  // Step 3: Reveal secret on EVM to claim
  console.log('Claiming EVM HTLC with secret...');
  // ... EVM claim logic

  // Step 4: Use same secret to claim on NEAR
  console.log('Claiming NEAR HTLC with revealed secret...');
  const receiverSDK = new NearFusionSDK(NEAR_CONFIG);
  await receiverSDK.connect(EVM_ACCOUNT.address, '...'); // Would need NEAR account
  await receiverSDK.withdrawHTLC(swap.htlcId, swap.secret);

  console.log('Cross-chain swap completed!\n');
}

async function testRefundScenario() {
  console.log('=== Testing Refund Scenario ===');
  
  const senderSDK = new NearFusionSDK(NEAR_CONFIG);
  await senderSDK.connect(NEAR_SENDER.accountId, NEAR_SENDER.privateKey);

  // Create HTLC with short timelock
  console.log('Creating HTLC with short timelock...');
  const swap = await senderSDK.createHTLC({
    receiver: NEAR_RECEIVER.accountId,
    timelockSeconds: 5, // Very short for testing
    amount: NearFusionSDK.parseNearAmount('1'),
  });

  console.log(`HTLC created: ${swap.htlcId}`);

  // Wait for expiry
  console.log('Waiting for HTLC to expire...');
  await new Promise(resolve => setTimeout(resolve, 6000));

  // Check if can refund
  const canRefund = await senderSDK.canRefund(swap.htlcId);
  console.log(`Can refund: ${canRefund}`);

  // Refund
  if (canRefund) {
    console.log('Refunding HTLC...');
    await senderSDK.refundHTLC(swap.htlcId);
    
    const finalHtlc = await senderSDK.getHTLC(swap.htlcId);
    console.log('Final HTLC status:', finalHtlc?.status);
  }

  console.log('Test completed!\n');
}

async function testContractStats() {
  console.log('=== Testing Contract Stats ===');
  
  const sdk = new NearFusionSDK(NEAR_CONFIG);
  await sdk.connect();

  const stats = await sdk.getStats();
  console.log('Contract Statistics:');
  console.log(`Total Volume: ${NearFusionSDK.formatNearAmount(stats.totalVolume)} NEAR`);
  console.log(`Total HTLCs Created: ${stats.totalHTLCs}`);
  console.log(`Active HTLCs: ${stats.activeHTLCs}`);

  // Get active HTLCs
  const activeHTLCs = await sdk.getActiveHTLCs(0, 10);
  console.log(`\nActive HTLCs (showing ${activeHTLCs.length}):`);
  for (const htlc of activeHTLCs) {
    console.log(`- ${htlc.id}: ${NearFusionSDK.formatNearAmount(htlc.total_amount)} NEAR`);
  }

  console.log('Test completed!\n');
}

// Main test runner
async function runAllTests() {
  console.log('Starting NEAR Fusion+ Integration Tests\n');

  try {
    await testBasicHTLC();
    await testPartialFills();
    await testCrossChainSwap();
    await testRefundScenario();
    await testContractStats();
    
    console.log('All tests completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

export {
  testBasicHTLC,
  testPartialFills,
  testCrossChainSwap,
  testRefundScenario,
  testContractStats,
};