const { ethers } = require('ethers');
const { execSync } = require('child_process');
const crypto = require('crypto');
const StellarSdk = require('@stellar/stellar-sdk');

// Configuration
const SEPOLIA_RPC_URL = 'https://eth-sepolia.public.blastapi.io';
const STELLAR_HTLC = 'CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V';
const SEPOLIA_HTLC = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;
const STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';

// Amounts for testing
const XLM_AMOUNT = '10000000'; // 1 XLM in stroops
const ETH_AMOUNT = '0.001'; // 0.001 ETH

console.log('💰 Cross-Chain Swap Balance Tracking Test\n');
console.log('═══════════════════════════════════════════\n');

// Helper function to get Stellar balance
async function getStellarBalance(address) {
  try {
    const server = new StellarSdk.Horizon.Server(STELLAR_HORIZON_URL);
    const account = await server.loadAccount(address);
    const xlmBalance = account.balances.find(b => b.asset_type === 'native');
    return xlmBalance ? parseFloat(xlmBalance.balance) : 0;
  } catch (error) {
    console.error('Error getting Stellar balance:', error.message);
    return 0;
  }
}

// Helper function to get Ethereum balance
async function getEthBalance(address, provider) {
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
}

async function trackBalancesForSwap() {
  try {
    // Setup
    const stellarAddress = execSync('stellar keys address deployer').toString().trim();
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(SEPOLIA_PRIVATE_KEY, provider);
    const ethAddress = wallet.address;

    console.log('📍 Addresses:');
    console.log(`Stellar: ${stellarAddress}`);
    console.log(`Sepolia: ${ethAddress}\n`);

    // Get initial balances
    console.log('📊 Initial Balances:');
    const initialStellarBalance = await getStellarBalance(stellarAddress);
    const initialEthBalance = await getEthBalance(ethAddress, provider);
    console.log(`Stellar: ${initialStellarBalance} XLM`);
    console.log(`Sepolia: ${initialEthBalance} ETH\n`);

    // Test 1: Stellar to Sepolia swap
    console.log('🔄 Test 1: Stellar → Sepolia Swap');
    console.log('─────────────────────────────────');
    console.log(`Swapping: 1 XLM → ${ETH_AMOUNT} ETH (simulated)\n`);

    // Create HTLC on Stellar
    const secret1 = crypto.randomBytes(32);
    const hashlock1 = ethers.keccak256(secret1);
    const timelock1 = Math.floor(Date.now() / 1000) + 3600;

    console.log('1️⃣ Creating HTLC on Stellar with 1 XLM...');
    const createCmd = `stellar contract invoke \
      --id ${STELLAR_HTLC} \
      --source deployer \
      --network testnet \
      -- create_htlc \
      --sender ${stellarAddress} \
      --receiver ${stellarAddress} \
      --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
      --amount ${XLM_AMOUNT} \
      --hashlock ${hashlock1.slice(2)} \
      --timelock ${timelock1}`;

    const htlcId1 = execSync(createCmd, { encoding: 'utf-8' }).trim();
    console.log(`✅ HTLC created with ID: ${htlcId1}`);

    // Check balance after HTLC creation
    const afterHTLCBalance = await getStellarBalance(stellarAddress);
    console.log(`\n📉 Stellar balance after HTLC: ${afterHTLCBalance} XLM`);
    console.log(`   Change: -${(initialStellarBalance - afterHTLCBalance).toFixed(7)} XLM`);

    // Simulate resolver creating Sepolia HTLC and user claiming
    console.log('\n2️⃣ Resolver creates HTLC on Sepolia (simulated)');
    console.log('3️⃣ User reveals secret on Sepolia to claim ETH');

    // Withdraw from Stellar HTLC
    console.log('\n4️⃣ Withdrawing from Stellar HTLC...');
    const withdrawCmd = `stellar contract invoke \
      --id ${STELLAR_HTLC} \
      --source deployer \
      --network testnet \
      -- withdraw \
      --htlc_id ${htlcId1} \
      --secret ${secret1.toString('hex')}`;

    execSync(withdrawCmd, { encoding: 'utf-8' });
    console.log('✅ Withdrawn from Stellar HTLC');

    // Final balance check for Test 1
    const finalStellarBalance1 = await getStellarBalance(stellarAddress);
    console.log(`\n📊 Stellar balance after withdrawal: ${finalStellarBalance1} XLM`);
    console.log(`   Net change: -${(initialStellarBalance - finalStellarBalance1).toFixed(7)} XLM (fees only)`);

    // Test 2: Sepolia to Stellar swap
    console.log('\n\n🔄 Test 2: Sepolia → Stellar Swap');
    console.log('─────────────────────────────────');
    console.log(`Swapping: ${ETH_AMOUNT} ETH → 1 XLM\n`);

    // Create HTLC on Sepolia
    const secret2 = crypto.randomBytes(32);
    const hashlock2 = ethers.keccak256(secret2);
    const timelock2 = Math.floor(Date.now() / 1000) + 3600;

    console.log(`1️⃣ Creating HTLC on Sepolia with ${ETH_AMOUNT} ETH...`);
    const htlcABI = [
      'function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32)',
      'function withdraw(bytes32 _contractId, bytes32 _preimage)',
      'function getContract(bytes32 _contractId) view returns (address sender, address receiver, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, bytes32 preimage)'
    ];

    const htlcContract = new ethers.Contract(SEPOLIA_HTLC, htlcABI, wallet);
    const tx = await htlcContract.createHTLC(
      ethAddress, // Using same address for demo
      hashlock2,
      timelock2,
      { value: ethers.parseEther(ETH_AMOUNT) }
    );

    console.log(`Transaction: ${tx.hash}`);
    const receipt = await tx.wait();
    const contractId2 = receipt.logs[0].topics[1];
    console.log(`✅ HTLC created with ID: ${contractId2}`);

    // Check ETH balance after HTLC
    const afterHTLCEthBalance = await getEthBalance(ethAddress, provider);
    console.log(`\n📉 Sepolia balance after HTLC: ${afterHTLCEthBalance} ETH`);
    console.log(`   Change: -${(parseFloat(initialEthBalance) - parseFloat(afterHTLCEthBalance)).toFixed(6)} ETH`);

    // Get HTLC details
    const htlcDetails = await htlcContract.getContract(contractId2);
    console.log(`\n📋 HTLC Details:`);
    console.log(`   Amount locked: ${ethers.formatEther(htlcDetails[2])} ETH`);
    console.log(`   Receiver: ${htlcDetails[1]}`);

    // Simulate resolver creating Stellar HTLC
    console.log('\n2️⃣ Resolver would create HTLC on Stellar with 1 XLM');
    console.log('3️⃣ User would reveal secret on Stellar to claim 1 XLM');

    // Withdraw from Sepolia HTLC
    console.log('\n4️⃣ Withdrawing from Sepolia HTLC...');
    const withdrawTx = await htlcContract.withdraw(contractId2, secret2);
    await withdrawTx.wait();
    console.log('✅ Withdrawn from Sepolia HTLC');

    // Final balance check for Test 2
    const finalEthBalance = await getEthBalance(ethAddress, provider);
    console.log(`\n📊 Sepolia balance after withdrawal: ${finalEthBalance} ETH`);
    console.log(`   Net change: -${(parseFloat(initialEthBalance) - parseFloat(finalEthBalance)).toFixed(6)} ETH (gas fees only)`);

    // Summary
    console.log('\n\n📊 FINAL SUMMARY');
    console.log('═══════════════════════════════════════════');
    console.log('Initial Balances:');
    console.log(`  Stellar: ${initialStellarBalance} XLM`);
    console.log(`  Sepolia: ${initialEthBalance} ETH`);
    console.log('\nFinal Balances:');
    console.log(`  Stellar: ${finalStellarBalance1} XLM`);
    console.log(`  Sepolia: ${finalEthBalance} ETH`);
    console.log('\nFees Paid:');
    console.log(`  Stellar: ~${(initialStellarBalance - finalStellarBalance1).toFixed(7)} XLM`);
    console.log(`  Sepolia: ~${(parseFloat(initialEthBalance) - parseFloat(finalEthBalance)).toFixed(6)} ETH`);
    console.log('\n✅ Both swaps completed successfully!');
    console.log('💡 In real swaps, you would gain the swapped currency on the other chain.');

  } catch (error) {
    console.error('\n❌ Error:', error);
  }
}

// Run the test
trackBalancesForSwap();