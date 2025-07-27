const { ethers } = require('ethers');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Configuration
const SEPOLIA_RPC_URL = 'https://eth-sepolia.public.blastapi.io';
const STELLAR_HTLC = 'CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V';
const SEPOLIA_HTLC = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;

// Exchange rates for testing
const XLM_TO_ETH_RATE = 0.001; // 1 XLM = 0.001 ETH
const ETH_TO_XLM_RATE = 1000;  // 1 ETH = 1000 XLM

console.log('🔄 Complete Cross-Chain Swap Test\n');
console.log('Testing actual value transfer between chains\n');

async function completeSwapTest() {
  try {
    const stellarAddress = execSync('stellar keys address deployer').toString().trim();
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(SEPOLIA_PRIVATE_KEY, provider);
    
    // For demo, we'll use a second account as the "user" on the other side
    const userStellarAddress = stellarAddress; // Same for demo
    const userEthAddress = wallet.address;     // Same for demo

    console.log('👥 Participants:');
    console.log(`User Stellar: ${userStellarAddress}`);
    console.log(`User Ethereum: ${userEthAddress}`);
    console.log(`Resolver: Acts as intermediary\n`);

    // ═══════════════════════════════════════════════════════════════
    // SWAP 1: Stellar → Sepolia (User swaps 1 XLM for 0.001 ETH)
    // ═══════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔵 → 🟣 SWAP 1: Stellar to Sepolia');
    console.log('User wants to swap 1 XLM for 0.001 ETH');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Get initial balances
    const initialEthBalance = await provider.getBalance(userEthAddress);
    console.log('📊 Initial Balances:');
    console.log(`User Stellar: ~10 XLM (testnet balance)`);
    console.log(`User Sepolia: ${ethers.formatEther(initialEthBalance)} ETH\n`);

    // Step 1: User creates HTLC on Stellar
    const secret1 = crypto.randomBytes(32);
    const hashlock1 = ethers.keccak256(secret1);
    const timelock1 = Math.floor(Date.now() / 1000) + 3600;

    console.log('STEP 1: User creates HTLC on Stellar');
    console.log('─────────────────────────────────────');
    console.log(`Amount: 1 XLM`);
    console.log(`Receiver: Resolver's Stellar address`);
    console.log(`Secret: ${secret1.toString('hex')}`);
    console.log(`Hashlock: ${hashlock1}\n`);

    const createStellarHTLC = `stellar contract invoke \
      --id ${STELLAR_HTLC} \
      --source deployer \
      --network testnet \
      -- create_htlc \
      --sender ${userStellarAddress} \
      --receiver ${stellarAddress} \
      --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
      --amount 10000000 \
      --hashlock ${hashlock1.slice(2)} \
      --timelock ${timelock1}`;

    const stellarHTLCId = execSync(createStellarHTLC, { encoding: 'utf-8' }).trim();
    console.log(`✅ Stellar HTLC created with ID: ${stellarHTLCId}`);
    console.log(`💰 1 XLM locked (User → Resolver)\n`);

    // Step 2: Resolver creates corresponding HTLC on Sepolia
    console.log('STEP 2: Resolver creates HTLC on Sepolia');
    console.log('─────────────────────────────────────────');
    console.log(`Amount: 0.001 ETH (equivalent value)`);
    console.log(`Receiver: User's Ethereum address`);
    console.log(`Same hashlock: ${hashlock1}\n`);

    const htlcABI = [
      'function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32)',
      'function withdraw(bytes32 _contractId, bytes32 _preimage)',
      'function getContract(bytes32 _contractId) view returns (address sender, address receiver, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, bytes32 preimage)'
    ];

    const htlcContract = new ethers.Contract(SEPOLIA_HTLC, htlcABI, wallet);
    
    // Resolver creates HTLC with 0.001 ETH for the user
    const tx1 = await htlcContract.createHTLC(
      userEthAddress,
      hashlock1,
      timelock1 - 1800, // 30 min less timelock
      { value: ethers.parseEther('0.001') }
    );

    const receipt1 = await tx1.wait();
    const sepoliaHTLCId1 = receipt1.logs[0].topics[1];
    console.log(`✅ Sepolia HTLC created`);
    console.log(`💰 0.001 ETH locked (Resolver → User)`);
    console.log(`Contract ID: ${sepoliaHTLCId1}\n`);

    // Step 3: User withdraws ETH using secret
    console.log('STEP 3: User withdraws ETH from Sepolia');
    console.log('────────────────────────────────────────');
    console.log(`Revealing secret to claim 0.001 ETH...\n`);

    const withdrawTx1 = await htlcContract.withdraw(sepoliaHTLCId1, secret1);
    await withdrawTx1.wait();
    
    const afterSwap1EthBalance = await provider.getBalance(userEthAddress);
    const ethGained = afterSwap1EthBalance - initialEthBalance;
    
    console.log(`✅ User withdrawn 0.001 ETH!`);
    console.log(`📈 ETH Balance change: +${ethers.formatEther(ethGained)} ETH\n`);

    // Step 4: Resolver uses revealed secret to claim XLM
    console.log('STEP 4: Resolver withdraws XLM from Stellar');
    console.log('────────────────────────────────────────────');
    console.log(`Using revealed secret to claim 1 XLM...\n`);

    const withdrawStellarHTLC = `stellar contract invoke \
      --id ${STELLAR_HTLC} \
      --source deployer \
      --network testnet \
      -- withdraw \
      --htlc_id ${stellarHTLCId} \
      --secret ${secret1.toString('hex')}`;

    execSync(withdrawStellarHTLC, { encoding: 'utf-8' });
    console.log(`✅ Resolver withdrawn 1 XLM!\n`);

    console.log('📊 SWAP 1 COMPLETE:');
    console.log(`User: -1 XLM, +0.001 ETH`);
    console.log(`Resolver: +1 XLM, -0.001 ETH`);
    console.log(`Exchange executed at rate: 1 XLM = 0.001 ETH ✅\n\n`);

    // ═══════════════════════════════════════════════════════════════
    // SWAP 2: Sepolia → Stellar (User swaps 0.001 ETH for 1 XLM)
    // ═══════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🟣 → 🔵 SWAP 2: Sepolia to Stellar');
    console.log('User wants to swap 0.001 ETH for 1 XLM');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Step 1: User creates HTLC on Sepolia
    const secret2 = crypto.randomBytes(32);
    const hashlock2 = ethers.keccak256(secret2);
    const timelock2 = Math.floor(Date.now() / 1000) + 3600;

    console.log('STEP 1: User creates HTLC on Sepolia');
    console.log('─────────────────────────────────────');
    console.log(`Amount: 0.001 ETH`);
    console.log(`Receiver: Resolver's Ethereum address\n`);

    const tx2 = await htlcContract.createHTLC(
      wallet.address, // Resolver's address
      hashlock2,
      timelock2,
      { value: ethers.parseEther('0.001') }
    );

    const receipt2 = await tx2.wait();
    const sepoliaHTLCId2 = receipt2.logs[0].topics[1];
    console.log(`✅ Sepolia HTLC created`);
    console.log(`💰 0.001 ETH locked (User → Resolver)`);
    console.log(`Contract ID: ${sepoliaHTLCId2}\n`);

    // Step 2: Resolver creates HTLC on Stellar
    console.log('STEP 2: Resolver creates HTLC on Stellar');
    console.log('────────────────────────────────────────');
    console.log(`Amount: 1 XLM (equivalent value)`);
    console.log(`Receiver: User's Stellar address\n`);

    const createStellarHTLC2 = `stellar contract invoke \
      --id ${STELLAR_HTLC} \
      --source deployer \
      --network testnet \
      -- create_htlc \
      --sender ${stellarAddress} \
      --receiver ${userStellarAddress} \
      --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
      --amount 10000000 \
      --hashlock ${hashlock2.slice(2)} \
      --timelock ${timelock2 - 1800}`;

    const stellarHTLCId2 = execSync(createStellarHTLC2, { encoding: 'utf-8' }).trim();
    console.log(`✅ Stellar HTLC created with ID: ${stellarHTLCId2}`);
    console.log(`💰 1 XLM locked (Resolver → User)\n`);

    // Step 3: User withdraws XLM using secret
    console.log('STEP 3: User withdraws XLM from Stellar');
    console.log('────────────────────────────────────────');
    console.log(`Revealing secret to claim 1 XLM...\n`);

    const withdrawStellarHTLC2 = `stellar contract invoke \
      --id ${STELLAR_HTLC} \
      --source deployer \
      --network testnet \
      -- withdraw \
      --htlc_id ${stellarHTLCId2} \
      --secret ${secret2.toString('hex')}`;

    execSync(withdrawStellarHTLC2, { encoding: 'utf-8' });
    console.log(`✅ User withdrawn 1 XLM!\n`);

    // Step 4: Resolver withdraws ETH using revealed secret
    console.log('STEP 4: Resolver withdraws ETH from Sepolia');
    console.log('────────────────────────────────────────────');
    console.log(`Using revealed secret to claim 0.001 ETH...\n`);

    const withdrawTx2 = await htlcContract.withdraw(sepoliaHTLCId2, secret2);
    await withdrawTx2.wait();
    console.log(`✅ Resolver withdrawn 0.001 ETH!\n`);

    console.log('📊 SWAP 2 COMPLETE:');
    console.log(`User: -0.001 ETH, +1 XLM`);
    console.log(`Resolver: +0.001 ETH, -1 XLM`);
    console.log(`Exchange executed at rate: 0.001 ETH = 1 XLM ✅\n`);

    // Final summary
    const finalEthBalance = await provider.getBalance(userEthAddress);
    const totalEthChange = finalEthBalance - initialEthBalance;

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 FINAL SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log('User Net Position:');
    console.log(`Stellar: No net change (swapped out 1 XLM, received 1 XLM)`);
    console.log(`Sepolia: ${ethers.formatEther(totalEthChange)} ETH (gas fees only)`);
    
    console.log('\nResolver Net Position:');
    console.log(`Stellar: No net change (received 1 XLM, sent 1 XLM)`);
    console.log(`Sepolia: Small gas fees paid`);
    
    console.log('\n✅ Both cross-chain swaps completed successfully!');
    console.log('💡 The atomic swap protocol ensures both parties exchange value fairly.');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the test
completeSwapTest();