const { ethers } = require('ethers');
const StellarSdk = require('@stellar/stellar-sdk');
const crypto = require('crypto');

// Configuration
const SEPOLIA_RPC_URL = 'https://eth-sepolia.public.blastapi.io';
const SEPOLIA_HTLC_ADDRESS = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';
const STELLAR_HTLC_CONTRACT = 'CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V';
const STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';


const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY || '';
const STELLAR_SECRET_KEY = process.env.STELLAR_SECRET_KEY || '';

const HTLC_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "_receiver", "type": "address" },
      { "internalType": "bytes32", "name": "_hashlock", "type": "bytes32" },
      { "internalType": "uint256", "name": "_timelock", "type": "uint256" }
    ],
    "name": "createHTLC",
    "outputs": [{ "internalType": "bytes32", "name": "contractId", "type": "bytes32" }],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "_contractId", "type": "bytes32" },
      { "internalType": "bytes32", "name": "_preimage", "type": "bytes32" }
    ],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "bytes32", "name": "contractId", "type": "bytes32" },
      { "indexed": true, "internalType": "address", "name": "sender", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "receiver", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "indexed": false, "internalType": "bytes32", "name": "hashlock", "type": "bytes32" },
      { "indexed": false, "internalType": "uint256", "name": "timelock", "type": "uint256" }
    ],
    "name": "HTLCCreated",
    "type": "event"
  }
];

async function testSepoliaToStellar() {
  console.log('🔄 Testing Sepolia to Stellar Cross-Chain Swap\n');

  // Generate secret and hashlock
  const secret = crypto.randomBytes(32);
  const hashlock = ethers.keccak256(secret);
  console.log('🔐 Generated secret:', secret.toString('hex'));
  console.log('🔒 Hashlock:', hashlock);

  // Setup Ethereum provider and signer
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
  const signer = new ethers.Wallet(SEPOLIA_PRIVATE_KEY, provider);
  const htlcContract = new ethers.Contract(SEPOLIA_HTLC_ADDRESS, HTLC_ABI, signer);

  // Setup timelock (1 hour from now)
  const timelock = Math.floor(Date.now() / 1000) + 3600;

  // Step 1: Create HTLC on Sepolia
  console.log('\n📝 Step 1: Creating HTLC on Sepolia...');
  
  // Use the deployer address as receiver for testing
  const resolverAddress = '0x666446eC2343e9E7e3D75C4C5b6A15355Ec7d7D4'; // Using our deployer address
  const amountInWei = ethers.parseEther('0.01'); // 0.01 ETH

  try {
    const tx = await htlcContract.createHTLC(
      resolverAddress,
      hashlock,
      timelock,
      { value: amountInWei }
    );
    
    console.log('Transaction sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('✅ HTLC created on Sepolia!');
    
    // Get contract ID from events
    const event = receipt.logs.find(log => {
      try {
        const parsed = htlcContract.interface.parseLog({ topics: log.topics, data: log.data });
        return parsed && parsed.name === 'HTLCCreated';
      } catch {
        return false;
      }
    });
    
    if (event) {
      const parsed = htlcContract.interface.parseLog({ topics: event.topics, data: event.data });
      const contractId = parsed.args.contractId;
      console.log('Contract ID:', contractId);
      
      // Step 2: Create corresponding HTLC on Stellar
      console.log('\n📝 Step 2: Creating corresponding HTLC on Stellar...');
      
      // Convert hashlock to Stellar format (BytesN<32>)
      const hashlockBuffer = Buffer.from(hashlock.slice(2), 'hex');
      
      // Show Stellar HTLC creation command
      const stellarAddress = 'GAD5WVZJM3LQDORES47DEDS4DS5GFE4AWBXWFQ6DBLZT5YMMZKHXZKXM'; // Using deployer address
      const hashlockHex = hashlock.slice(2); // Remove 0x prefix
      
      // For demo, we'll simulate the resolver creating the Stellar HTLC
      // In production, the resolver would do this after seeing the Sepolia HTLC
      
      console.log('\n💡 Next steps:');
      console.log('1. Resolver monitors Sepolia HTLC creation');
      console.log('2. Resolver creates corresponding HTLC on Stellar:');
      console.log('\nstellar contract invoke \\');
      console.log(`  --id ${STELLAR_HTLC_CONTRACT} \\`);
      console.log('  --source deployer \\');
      console.log('  --network testnet \\');
      console.log('  -- create_htlc \\');
      console.log(`  --sender ${stellarAddress} \\`);
      console.log(`  --receiver YOUR_STELLAR_ADDRESS \\`);
      console.log('  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \\');
      console.log('  --amount 100000000 \\');
      console.log(`  --hashlock ${hashlockHex} \\`);
      console.log(`  --timelock ${Math.floor(Date.now() / 1000) + 1800}`);
      console.log('\n3. User reveals secret on Stellar to withdraw');
      console.log('4. Resolver uses revealed secret to withdraw from Sepolia HTLC');
      
      // Return the secret for testing
      return {
        secret: secret.toString('hex'),
        hashlock,
        contractId,
        sepoliaTx: tx.hash
      };
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the test
if (require.main === module) {
  testSepoliaToStellar()
    .then(result => {
      if (result) {
        console.log('\n✅ Test setup complete!');
        console.log('Secret to use for withdrawal:', result.secret);
      }
    })
    .catch(console.error);
}