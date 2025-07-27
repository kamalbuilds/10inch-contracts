const { ethers } = require('ethers');
const { execSync } = require('child_process');
const crypto = require('crypto');

// Configuration
const SEPOLIA_RPC_URL = 'https://eth-sepolia.public.blastapi.io';
const STELLAR_HTLC_CONTRACT = 'CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V';

// Test configuration
const STELLAR_SOURCE = 'deployer'; // Uses the deployer key we created
const SEPOLIA_RECEIVER = '0x666446eC2343e9E7e3D75C4C5b6A15355Ec7d7D4'; 

async function testStellarToSepolia() {
  console.log('🔄 Testing Stellar to Sepolia Cross-Chain Swap\n');

  // Generate secret and hashlock
  const secret = crypto.randomBytes(32);
  const hashlock = ethers.keccak256(secret);
  console.log('🔐 Generated secret:', secret.toString('hex'));
  console.log('🔒 Hashlock (keccak256):', hashlock);

  // Convert to Stellar format
  const hashlockHex = hashlock.slice(2); // Remove 0x prefix
  
  // Get Stellar account info
  const stellarAddress = execSync('stellar keys address deployer').toString().trim();
  console.log('🌟 Stellar sender:', stellarAddress);

  // Step 1: Create HTLC on Stellar
  console.log('\n📝 Step 1: Creating HTLC on Stellar...');
  
  // For this test, we'll use a test token (native XLM)
  // The receiver would be the resolver's Stellar address
  const resolverStellarAddress = stellarAddress; // Using same address for testing
  const amount = 1000000000; // 100 XLM in stroops
  const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  try {
    // Create HTLC using Stellar CLI
    const createCommand = `stellar contract invoke \
      --id ${STELLAR_HTLC_CONTRACT} \
      --source ${STELLAR_SOURCE} \
      --network testnet \
      -- create_htlc \
      --sender ${stellarAddress} \
      --receiver ${resolverStellarAddress} \
      --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
      --amount ${amount} \
      --hashlock ${hashlockHex} \
      --timelock ${timelock}`;
    
    console.log('Executing:', createCommand);
    const result = execSync(createCommand, { encoding: 'utf-8' });
    const htlcId = result.trim();
    console.log('✅ HTLC created on Stellar with ID:', htlcId);

    // Step 2: Resolver creates corresponding HTLC on Sepolia
    console.log('\n📝 Step 2: Resolver creates corresponding HTLC on Sepolia...');
    console.log('(In production, the resolver would monitor Stellar and create this automatically)');

    // Setup Ethereum provider (would be used by resolver)
    // const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    
    // Simulate resolver creating HTLC on Sepolia
    console.log('\n💡 Resolver actions:');
    console.log('1. Monitor Stellar HTLC creation');
    console.log('2. Create corresponding HTLC on Sepolia with:');
    console.log('   - Hashlock:', hashlock);
    console.log('   - Receiver:', SEPOLIA_RECEIVER);
    console.log('   - Amount: 0.01 ETH (example)');
    console.log('   - Timelock: 30 minutes from now');

    // Step 3: User reveals secret on Sepolia
    console.log('\n📝 Step 3: After resolver creates Sepolia HTLC...');
    console.log('User withdraws from Sepolia HTLC using secret:', secret.toString('hex'));
    
    // Step 4: Resolver uses revealed secret to withdraw from Stellar
    console.log('\n📝 Step 4: Resolver withdraws from Stellar HTLC...');
    
    const withdrawCommand = `stellar contract invoke \
      --id ${STELLAR_HTLC_CONTRACT} \
      --source ${STELLAR_SOURCE} \
      --network testnet \
      -- withdraw \
      --htlc_id ${htlcId} \
      --secret ${secret.toString('hex')}`;
    
    console.log('\nTo complete the swap, run:');
    console.log(withdrawCommand);

    return {
      secret: secret.toString('hex'),
      hashlock,
      htlcId,
      stellarAddress,
      commands: {
        withdraw: withdrawCommand
      }
    };

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testStellarToSepolia()
    .then(result => {
      if (result) {
        console.log('\n✅ Test setup complete!');
        console.log('HTLC ID:', result.htlcId);
        console.log('Secret:', result.secret);
      }
    })
    .catch(console.error);
}