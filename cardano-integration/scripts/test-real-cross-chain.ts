import { CardanoFusionClient } from '../src/cardano-fusion-client-mock';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf8')
);

async function testRealCrossChainSwap() {
  console.log('🚀 Testing Real Cardano ↔ Ethereum Sepolia Cross-Chain Swap\n');

  try {
    // 1. Setup Ethereum/Sepolia
    console.log('=== Setting up Ethereum Sepolia ===');
    const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);
    const sepoliaAddress = await wallet.getAddress();
    
    console.log('📍 Sepolia Wallet:', sepoliaAddress);
    const sepoliaBalance = await provider.getBalance(sepoliaAddress);
    console.log('💰 Sepolia Balance:', ethers.formatEther(sepoliaBalance), 'ETH\n');

    // 2. Setup Cardano (using mock for now)
    console.log('=== Setting up Cardano Preprod ===');
    const cardanoClient = new CardanoFusionClient(
      process.env.BLOCKFROST_URL!,
      process.env.BLOCKFROST_API_KEY!,
      'Preprod'
    );
    
    await cardanoClient.init(process.env.CARDANO_SEED_PHRASE);
    const cardanoAddress = await cardanoClient.getWalletAddress();
    
    console.log('📍 Cardano Address:', cardanoAddress);
    console.log('⚠️  Note: Using mock client - real Lucid implementation pending\n');

    // 3. HTLC Contract on Sepolia
    const htlcAddress = sharedDeployment.sepolia.contractAddress;
    const htlcABI = sharedDeployment.sepolia.abi;
    const htlcContract = new ethers.Contract(htlcAddress, htlcABI, wallet);
    
    console.log('📄 HTLC Contract on Sepolia:', htlcAddress);

    // 4. Test Sepolia → Cardano Swap
    console.log('\n=== Testing Sepolia → Cardano Swap ===\n');
    
    // Generate secret for atomic swap
    const { secret, secretHash } = CardanoFusionClient.generateSecret();
    console.log('🔐 Secret Hash:', secretHash);
    
    // Create HTLC on Sepolia
    const amount = ethers.parseEther('0.001'); // 0.001 ETH
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    console.log('📝 Creating HTLC on Sepolia...');
    console.log('- Amount:', ethers.formatEther(amount), 'ETH');
    console.log('- Target Chain: Cardano Preprod');
    console.log('- Target Address:', cardanoAddress);
    console.log('- Timelock:', new Date(timelock * 1000).toLocaleString());
    
    try {
      // For cross-chain, we'll use the sender's address as recipient for testing
      // In production, this would be the relayer's address who will create HTLC on Cardano
      const relayerAddress = sepoliaAddress;
      
      const tx = await htlcContract.createHTLC(
        relayerAddress,
        '0x' + secretHash,
        timelock,
        { value: amount }
      );
      
      console.log('📤 Transaction sent:', tx.hash);
      const receipt = await tx.wait();
      console.log('✅ HTLC created on Sepolia!');
      
      // Get contract ID from events
      const event = receipt.logs.find((log: any) => 
        log.topics[0] === ethers.id('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256)')
      );
      const contractId = event?.topics[1];
      console.log('📋 Contract ID:', contractId);
      
      // In real implementation, relayer would:
      // 1. Detect this HTLC on Sepolia
      // 2. Create corresponding HTLC on Cardano
      // 3. User claims on Cardano with secret
      // 4. Relayer claims on Sepolia with revealed secret
      
    } catch (error: any) {
      console.error('❌ Failed to create HTLC:', error.message);
    }

    // 5. Show next steps
    console.log('\n📋 Next Steps for Complete Integration:');
    console.log('1. Deploy compiled Aiken contracts to Cardano Preprod');
    console.log('2. Implement real Lucid Evolution client (replacing mock)');
    console.log('3. Run relayer service to monitor both chains');
    console.log('4. Complete atomic swap flow with secret revelation');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Helper to check HTLC state
async function checkHTLCState(contract: ethers.Contract, contractId: string) {
  const htlc = await contract.getContract(contractId);
  console.log('\n📊 HTLC State:');
  console.log('- Sender:', htlc.sender);
  console.log('- Receiver:', htlc.receiver);
  console.log('- Amount:', ethers.formatEther(htlc.amount), 'ETH');
  console.log('- Withdrawn:', htlc.withdrawn);
  console.log('- Refunded:', htlc.refunded);
  if (htlc.preimage !== ethers.ZeroHash) {
    console.log('- Preimage:', htlc.preimage);
  }
}

// Run the test
testRealCrossChainSwap().catch(console.error);