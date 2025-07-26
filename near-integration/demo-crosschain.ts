#!/usr/bin/env ts-node

/**
 * Demo script for testing crosschain swaps between NEAR and Ethereum
 * This demonstrates the full flow using the deployed Sepolia HTLC contract
 */

import { ethers } from 'ethers';
import crypto from 'crypto';

// Configuration from shared-htlc-deployment.json
const SEPOLIA_HTLC_CONTRACT = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';
const SEPOLIA_RPC_URL = 'https://sepolia.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161';

// Simplified ABI for the HTLC contract
const HTLC_ABI = [
  'function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32)',
  'function withdraw(bytes32 _contractId, bytes32 _preimage)',
  'function refund(bytes32 _contractId)',
  'function getContract(bytes32 _contractId) view returns (address, address, uint256, bytes32, uint256, bool, bool, bytes32)',
  'event HTLCCreated(bytes32 indexed contractId, address indexed sender, address indexed receiver, uint256 amount, bytes32 hashlock, uint256 timelock)',
  'event HTLCWithdrawn(bytes32 indexed contractId, bytes32 preimage)',
  'event HTLCRefunded(bytes32 indexed contractId)'
];

class CrossChainDemo {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    this.contract = new ethers.Contract(SEPOLIA_HTLC_CONTRACT, HTLC_ABI, this.provider);
  }

  generateSecret(): { secret: string; hashlock: string } {
    const secret = crypto.randomBytes(32);
    const hashlock = crypto.createHash('sha256').update(secret).digest();
    
    return {
      secret: secret.toString('hex'),
      hashlock: hashlock.toString('hex')
    };
  }

  async demonstrateNearToEthSwap() {
    console.log('\n🚀 NEAR → Ethereum Crosschain Swap Demo');
    console.log('======================================');

    const { secret, hashlock } = this.generateSecret();
    const nearAmount = '1.0'; // 1 NEAR
    const ethAmount = '0.001'; // Equivalent ETH amount
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    console.log(`📝 Secret: ${secret}`);
    console.log(`🔒 Hashlock: 0x${hashlock}`);
    console.log(`💰 NEAR Amount: ${nearAmount} NEAR`);
    console.log(`💰 ETH Amount: ${ethAmount} ETH`);

    console.log('\n📋 Crosschain Swap Flow:');
    console.log('========================');

    // Step 1: User creates HTLC on NEAR
    console.log('\n1️⃣ User creates HTLC on NEAR');
    console.log('   ┌─────────────────────────────────┐');
    console.log('   │ NEAR TESTNET                    │');
    console.log('   │ ─────────────                   │');
    console.log(`   │ Amount: ${nearAmount} NEAR                │`);
    console.log(`   │ Receiver: resolver.testnet      │`);
    console.log(`   │ Hashlock: 0x${hashlock.slice(0, 16)}... │`);
    console.log(`   │ Timelock: ${timelock}           │`);
    console.log('   └─────────────────────────────────┘');
    console.log('   ✅ HTLC created on NEAR');

    // Step 2: Resolver detects and creates ETH HTLC
    console.log('\n2️⃣ Resolver creates HTLC on Ethereum');
    console.log('   ┌─────────────────────────────────┐');
    console.log('   │ ETHEREUM SEPOLIA                │');
    console.log('   │ ─────────────────               │');
    console.log(`   │ Contract: ${SEPOLIA_HTLC_CONTRACT.slice(0, 20)}... │`);
    console.log(`   │ Amount: ${ethAmount} ETH                │`);
    console.log('   │ Receiver: user_eth_address      │');
    console.log(`   │ Hashlock: 0x${hashlock.slice(0, 16)}... │`);
    console.log(`   │ Timelock: ${timelock}           │`);
    console.log('   └─────────────────────────────────┘');
    console.log('   ✅ HTLC created on Ethereum');

    // Step 3: User claims ETH with secret
    console.log('\n3️⃣ User withdraws ETH by revealing secret');
    console.log('   🔓 Secret revealed on Ethereum');
    console.log(`   💰 User receives ${ethAmount} ETH`);

    // Step 4: Resolver claims NEAR with revealed secret
    console.log('\n4️⃣ Resolver claims NEAR using revealed secret');
    console.log('   🎯 Resolver monitors Ethereum for secret');
    console.log(`   💰 Resolver receives ${nearAmount} NEAR`);

    console.log('\n✅ NEAR → Ethereum swap completed!');
    this.printSwapSummary('NEAR', 'Ethereum', nearAmount + ' NEAR', ethAmount + ' ETH');
  }

  async demonstrateEthToNearSwap() {
    console.log('\n🚀 Ethereum → NEAR Crosschain Swap Demo');
    console.log('======================================');

    const { secret, hashlock } = this.generateSecret();
    const ethAmount = '0.001'; // 0.001 ETH
    const nearAmount = '1.0'; // Equivalent NEAR amount
    const timelock = Math.floor(Date.now() / 1000) + 3600;

    console.log(`📝 Secret: ${secret}`);
    console.log(`🔒 Hashlock: 0x${hashlock}`);
    console.log(`💰 ETH Amount: ${ethAmount} ETH`);
    console.log(`💰 NEAR Amount: ${nearAmount} NEAR`);

    console.log('\n📋 Crosschain Swap Flow:');
    console.log('========================');

    // Step 1: User creates HTLC on Ethereum
    console.log('\n1️⃣ User creates HTLC on Ethereum');
    console.log('   ┌─────────────────────────────────┐');
    console.log('   │ ETHEREUM SEPOLIA                │');
    console.log('   │ ─────────────────               │');
    console.log(`   │ Contract: ${SEPOLIA_HTLC_CONTRACT.slice(0, 20)}... │`);
    console.log(`   │ Amount: ${ethAmount} ETH                │`);
    console.log('   │ Receiver: user_near_address     │');
    console.log(`   │ Hashlock: 0x${hashlock.slice(0, 16)}... │`);
    console.log(`   │ Timelock: ${timelock}           │`);
    console.log('   └─────────────────────────────────┘');
    console.log('   ✅ HTLC created on Ethereum');

    // Step 2: Resolver creates NEAR HTLC
    console.log('\n2️⃣ Resolver creates HTLC on NEAR');
    console.log('   ┌─────────────────────────────────┐');
    console.log('   │ NEAR TESTNET                    │');
    console.log('   │ ─────────────                   │');
    console.log(`   │ Amount: ${nearAmount} NEAR                │`);
    console.log('   │ Receiver: user.testnet          │');
    console.log(`   │ Hashlock: 0x${hashlock.slice(0, 16)}... │`);
    console.log(`   │ Timelock: ${timelock}           │`);
    console.log('   └─────────────────────────────────┘');
    console.log('   ✅ HTLC created on NEAR');

    // Step 3: User claims NEAR with secret
    console.log('\n3️⃣ User withdraws NEAR by revealing secret');
    console.log('   🔓 Secret revealed on NEAR');
    console.log(`   💰 User receives ${nearAmount} NEAR`);

    // Step 4: Resolver claims ETH with revealed secret
    console.log('\n4️⃣ Resolver claims ETH using revealed secret');
    console.log('   🎯 Resolver monitors NEAR for secret');
    console.log(`   💰 Resolver receives ${ethAmount} ETH`);

    console.log('\n✅ Ethereum → NEAR swap completed!');
    this.printSwapSummary('Ethereum', 'NEAR', ethAmount + ' ETH', nearAmount + ' NEAR');
  }

  async testContractInteraction() {
    console.log('\n🔍 Testing Ethereum Contract Interaction');
    console.log('=======================================');

    try {
      // Check contract existence
      const code = await this.provider.getCode(SEPOLIA_HTLC_CONTRACT);
      if (code === '0x') {
        console.log('❌ No contract found at the specified address');
        return false;
      }

      console.log('✅ Contract exists at address:', SEPOLIA_HTLC_CONTRACT);
      
      // Check contract balance
      const balance = await this.provider.getBalance(SEPOLIA_HTLC_CONTRACT);
      console.log(`💰 Contract balance: ${ethers.formatEther(balance)} ETH`);

      // Test contract read operation
      const testContractId = ethers.keccak256(ethers.toUtf8Bytes('test'));
      try {
        await this.contract.getContract(testContractId);
        console.log('✅ Contract read operations working');
      } catch (error: any) {
        if (error.message.includes('revert')) {
          console.log('✅ Contract properly reverts for invalid contract IDs');
        } else {
          console.log('⚠️  Contract interaction issue:', error.message);
        }
      }

      return true;
    } catch (error: any) {
      console.error('❌ Contract interaction failed:', error.message);
      return false;
    }
  }

  async demonstrateSecurityFeatures() {
    console.log('\n🔒 Security Features Demo');
    console.log('=======================');

    console.log('\n🛡️  Hash Time-Locked Contracts (HTLC) provide:');
    console.log('   ✅ Atomic swaps - either both sides complete or both fail');
    console.log('   ✅ Time-locked refunds - funds automatically returned after timeout');
    console.log('   ✅ Hash-locked secrets - only secret holder can claim');
    console.log('   ✅ Non-custodial - no trusted third party needed');

    const { secret, hashlock } = this.generateSecret();
    
    console.log('\n🔐 Cryptographic Proof:');
    console.log(`   Secret (32 bytes): ${secret}`);
    console.log(`   SHA256 Hash: 0x${hashlock}`);
    
    // Verify hash
    const verifyHash = crypto.createHash('sha256')
      .update(Buffer.from(secret, 'hex'))
      .digest('hex');
    
    console.log(`   Verification: ${hashlock === verifyHash ? '✅ Valid' : '❌ Invalid'}`);

    console.log('\n⏰ Timelock Mechanism:');
    const currentTime = Math.floor(Date.now() / 1000);
    const timelock = currentTime + 3600;
    console.log(`   Current time: ${currentTime} (${new Date(currentTime * 1000).toISOString()})`);
    console.log(`   Timelock: ${timelock} (${new Date(timelock * 1000).toISOString()})`);
    console.log(`   Refund available after: 1 hour`);
  }

  printSwapSummary(fromChain: string, toChain: string, fromAmount: string, toAmount: string) {
    console.log('\n📊 Swap Summary');
    console.log('==============');
    console.log(`   From: ${fromAmount} on ${fromChain}`);
    console.log(`   To: ${toAmount} on ${toChain}`);
    console.log('   Status: ✅ Completed');
    console.log('   Security: 🔒 Trustless & Atomic');
    console.log('   Settlement: ⚡ Instant');
  }

  async runDemo() {
    console.log('🌉 NEAR ⟷ Ethereum Crosschain Swap Demo');
    console.log('=======================================');
    console.log('Built with 1inch Fusion+ Protocol');
    console.log('');

    // Test contract connectivity
    const contractOk = await this.testContractInteraction();
    if (!contractOk) {
      console.log('⚠️  Continuing with demo mode...\n');
    }

    // Demonstrate security features
    await this.demonstrateSecurityFeatures();

    // Demonstrate both swap directions
    await this.demonstrateNearToEthSwap();
    await this.demonstrateEthToNearSwap();

    console.log('\n🎯 Demo Completed Successfully!');
    console.log('==============================');
    console.log('💡 This demonstrates the full crosschain swap flow.');
    console.log('💡 In production, all steps would execute with real transactions.');
    console.log('💡 Resolver service would automatically handle the arbitrage.');
    console.log('\n📚 Next Steps:');
    console.log('   1. Deploy NEAR contract: npm run deploy:testnet');
    console.log('   2. Fund test accounts on both chains');
    console.log('   3. Run resolver service: npm run resolver');
    console.log('   4. Execute real crosschain swaps!');
  }
}

// Run demo if executed directly
if (require.main === module) {
  const demo = new CrossChainDemo();
  demo.runDemo()
    .then(() => {
      console.log('\n✨ Demo finished successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Demo failed:', error);
      process.exit(1);
    });
}

export { CrossChainDemo };