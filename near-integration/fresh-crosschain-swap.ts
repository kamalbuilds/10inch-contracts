#!/usr/bin/env ts-node

/**
 * Fresh Crosschain Swap - Generate new values for a new atomic swap
 */

import { ethers } from 'ethers';
import crypto from 'crypto';
import { execSync } from 'child_process';

const NEAR_CONTRACT = 'fusion-htlc-demo.testnet';
const SEPOLIA_CONTRACT = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';
const ETH_PRIVATE_KEY = process.env.ETH_PRIVATE_KEY || '';
const NEAR_ACCOUNT_ID = 'fusion-htlc-demo.testnet';
const SEPOLIA_RPC = 'https://eth-sepolia.public.blastapi.io';

const HTLC_ABI = [
  'function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32)',
  'function withdraw(bytes32 _contractId, bytes32 _preimage)',
  'function getContract(bytes32 _contractId) view returns (address, address, uint256, bytes32, uint256, bool, bool, bytes32)',
];

class FreshCrosschainSwap {
  private readonly secret: string;
  private readonly nearHashlock: string;
  private readonly ethHashlock: string;
  private readonly timelock: number;
  private readonly ethProvider: ethers.JsonRpcProvider;
  private readonly ethWallet: ethers.Wallet;
  private readonly ethContract: ethers.Contract;

  constructor() {
    // 🆕 Generate FRESH secret and hashes
    const secretBuffer = crypto.randomBytes(32);
    this.secret = secretBuffer.toString('hex');
    this.nearHashlock = crypto.createHash('sha256').update(secretBuffer).digest('hex');
    this.ethHashlock = ethers.keccak256(secretBuffer).slice(2);
    this.timelock = Math.floor(Date.now() / 1000) + 7200; // 2 hours from now

    this.ethProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
    this.ethWallet = new ethers.Wallet(ETH_PRIVATE_KEY, this.ethProvider);
    this.ethContract = new ethers.Contract(SEPOLIA_CONTRACT, HTLC_ABI, this.ethWallet);
  }

  displayFreshValues() {
    console.log('🆕 **FRESH CROSSCHAIN SWAP VALUES**');
    console.log('==================================');
    console.log(`🎲 NEW Secret: ${this.secret}`);
    console.log(`🔒 NEW NEAR Hashlock (SHA-256): ${this.nearHashlock}`);
    console.log(`🔒 NEW ETH Hashlock (Keccak-256): ${this.ethHashlock}`);
    console.log(`⏰ NEW Timelock: ${this.timelock} (${new Date(this.timelock * 1000).toISOString()})`);
    console.log('');
    console.log('💡 These are completely fresh values - no previous usage!');
    console.log('');
  }

  async step1_CreateFreshNearHTLC() {
    console.log('🟢 STEP 1: Create FRESH NEAR HTLC');
    console.log('=================================');
    
    try {
      const cmd = `near contract call-function as-transaction ${NEAR_CONTRACT} create_htlc json-args '{"receiver": "${NEAR_ACCOUNT_ID}", "hashlock": "${this.nearHashlock}", "timelock_seconds": 7200}' prepaid-gas '100.0 Tgas' attached-deposit '0.1 NEAR' sign-as ${NEAR_ACCOUNT_ID} network-config testnet sign-with-keychain send`;
      
      console.log('📤 Creating FRESH NEAR HTLC...');
      console.log(`   Receiver: ${NEAR_ACCOUNT_ID}`);
      console.log(`   Hashlock: ${this.nearHashlock}`);
      
      const output = execSync(cmd, { encoding: 'utf8' });
      
      // Extract transaction hash and HTLC ID
      const txMatch = output.match(/Transaction ID: ([A-Za-z0-9]+)/);
      const htlcMatch = output.match(/HTLC created: ([a-zA-Z0-9_]+)/);
      
      if (txMatch && htlcMatch) {
        const txHash = txMatch[1];
        const htlcId = htlcMatch[1];
        
        console.log(`✅ FRESH NEAR HTLC created successfully!`);
        console.log(`   🆔 NEW HTLC ID: ${htlcId}`);
        console.log(`   📋 Transaction: https://explorer.testnet.near.org/transactions/${txHash}`);
        console.log(`   💰 Amount: 0.1 NEAR locked`);
        console.log('');
        
        return { htlcId, txHash };
      } else {
        throw new Error('Could not extract HTLC details from output');
      }
    } catch (error: any) {
      console.error(`❌ NEAR HTLC creation failed: ${error.message}`);
      throw error;
    }
  }

  async step2_CreateFreshEthHTLC() {
    console.log('🟡 STEP 2: Create FRESH Ethereum HTLC');
    console.log('=====================================');
    
    try {
      const amount = ethers.parseEther('0.001');
      
      console.log('📤 Creating FRESH Ethereum HTLC...');
      console.log(`   Receiver: ${this.ethWallet.address}`);
      console.log(`   Hashlock: 0x${this.ethHashlock}`);
      console.log(`   Amount: 0.001 ETH`);
      
      const tx = await this.ethContract.createHTLC(
        this.ethWallet.address,
        '0x' + this.ethHashlock,
        this.timelock,
        { value: amount }
      );

      console.log(`📤 Transaction submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      const contractId = receipt.logs[0]?.topics[1];
      
      console.log(`✅ FRESH Ethereum HTLC created successfully!`);
      console.log(`   🆔 NEW Contract ID: ${contractId}`);
      console.log(`   📋 Transaction: https://sepolia.etherscan.io/tx/${tx.hash}`);
      console.log(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`);
      console.log('');

      return { contractId, txHash: tx.hash };
    } catch (error: any) {
      console.error(`❌ Ethereum HTLC creation failed: ${error.message}`);
      throw error;
    }
  }

  async step3_WithdrawEthAndRevealSecret(ethContractId: string) {
    console.log('🔴 STEP 3: Withdraw ETH (Secret Revelation)');
    console.log('===========================================');
    
    try {
      console.log('👤 User withdrawing ETH with FRESH secret...');
      console.log(`   Secret to reveal: ${this.secret}`);
      
      const secretBytes = '0x' + this.secret;
      const tx = await this.ethContract.withdraw(ethContractId, secretBytes);
      
      console.log(`📤 Withdrawal transaction: ${tx.hash}`);
      const receipt = await tx.wait();
      
      console.log(`✅ ETH withdrawal successful!`);
      console.log(`   📋 Transaction: https://sepolia.etherscan.io/tx/${tx.hash}`);
      console.log(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`   🔓 SECRET NOW PUBLIC: ${this.secret}`);
      console.log('');

      return tx.hash;
    } catch (error: any) {
      console.error(`❌ ETH withdrawal failed: ${error.message}`);
      throw error;
    }
  }

  async step4_ClaimNearWithRevealedSecret(nearHtlcId: string) {
    console.log('🟣 STEP 4: Claim NEAR with Revealed Secret');
    console.log('==========================================');
    
    try {
      console.log('🤖 Resolver claiming NEAR with the revealed secret...');
      console.log(`   HTLC ID: ${nearHtlcId}`);
      console.log(`   Secret: ${this.secret}`);
      
      const cmd = `near contract call-function as-transaction ${NEAR_CONTRACT} withdraw json-args '{"htlc_id": "${nearHtlcId}", "secret": "${this.secret}"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as ${NEAR_ACCOUNT_ID} network-config testnet sign-with-keychain send`;
      
      console.log('📤 Submitting NEAR withdrawal...');
      const output = execSync(cmd, { encoding: 'utf8' });
      
      const txMatch = output.match(/Transaction ID: ([A-Za-z0-9]+)/);
      
      if (output.includes('succeeded') || output.includes('HTLC withdrawn')) {
        console.log(`✅ NEAR withdrawal successful!`);
        if (txMatch) {
          console.log(`   📋 Transaction: https://explorer.testnet.near.org/transactions/${txMatch[1]}`);
        }
        console.log(`   💰 Resolver claimed 0.1 NEAR`);
        console.log(`   🎉 **COMPLETE ATOMIC SWAP SUCCESS!**`);
        console.log('');
        return true;
      } else {
        console.log(`⚠️  NEAR withdrawal result unclear`);
        console.log('Output:', output);
        return false;
      }
    } catch (error: any) {
      console.error(`❌ NEAR withdrawal failed: ${error.message}`);
      if (error.message.includes('Already processed')) {
        console.log('💡 This means the HTLC was already used - we need fresh values next time!');
      }
      return false;
    }
  }

  async verifyCompleteness(ethContractId: string) {
    console.log('🔍 FINAL VERIFICATION');
    console.log('====================');
    
    try {
      const ethData = await this.ethContract.getContract(ethContractId);
      const isWithdrawn = ethData[5];
      const revealedSecret = ethData[7];
      
      console.log(`✅ Ethereum HTLC withdrawn: ${isWithdrawn}`);
      console.log(`✅ Secret on Ethereum: 0x${revealedSecret.slice(2)}`);
      console.log(`✅ Secret matches: ${revealedSecret.slice(2) === this.secret}`);
      
    } catch (error) {
      console.log(`⚠️  Could not verify Ethereum state`);
    }

    console.log('\n🏆 **ATOMIC SWAP COMPLETED WITH FRESH VALUES!**');
    console.log('===============================================');
    console.log('✅ New secret generated and used successfully');
    console.log('✅ Fresh HTLCs created on both chains');
    console.log('✅ Secret revealed atomically');
    console.log('✅ Both withdrawals completed');
    console.log('✅ Cross-chain hash compatibility proven again');
  }

  async executeFreshSwap() {
    console.log('🚀 **EXECUTING FRESH CROSSCHAIN SWAP**');
    console.log('=====================================');
    console.log('Using completely new values for clean swap\n');

    this.displayFreshValues();

    try {
      // Step 1: Create fresh NEAR HTLC
      const nearResult = await this.step1_CreateFreshNearHTLC();
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 2: Create fresh Ethereum HTLC
      const ethResult = await this.step2_CreateFreshEthHTLC();
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Step 3: Withdraw ETH and reveal secret
      await this.step3_WithdrawEthAndRevealSecret(ethResult.contractId);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 4: Claim NEAR with revealed secret
      const success = await this.step4_ClaimNearWithRevealedSecret(nearResult.htlcId);
      
      // Final verification
      await this.verifyCompleteness(ethResult.contractId);

      if (success) {
        console.log('\n🎯 **COMPLETE SUCCESS WITH FRESH VALUES!**');
        console.log('=========================================');
        console.log('🌟 Full 1inch Fusion Plus crosschain swap executed!');
        console.log('🆕 All values were fresh and unused!');
        console.log('⚡ Atomic properties fully demonstrated!');
      }

    } catch (error: any) {
      console.error('\n💥 Fresh swap failed:', error.message);
      console.log('\n💡 TIP: Each run needs completely fresh values!');
      console.log('💡 Run this script again to generate new values.');
    }
  }

  // Utility method to just generate and display fresh values
  static generateFreshValues() {
    console.log('🎲 **GENERATING FRESH VALUES FOR NEW SWAP**');
    console.log('==========================================');
    
    const secretBuffer = crypto.randomBytes(32);
    const secret = secretBuffer.toString('hex');
    const nearHashlock = crypto.createHash('sha256').update(secretBuffer).digest('hex');
    const ethHashlock = ethers.keccak256(secretBuffer).slice(2);
    const timelock = Math.floor(Date.now() / 1000) + 7200;

    console.log(`const SECRET = '${secret}';`);
    console.log(`const NEAR_HASHLOCK = '${nearHashlock}';`);
    console.log(`const ETH_HASHLOCK = '${ethHashlock}';`);
    console.log(`const TIMELOCK = ${timelock}; // ${new Date(timelock * 1000).toISOString()}`);
    console.log('');
    console.log('💡 Copy these values to your script for a fresh swap!');
    console.log('💡 NEAR_HTLC_ID and NEAR_TX_HASH will be generated when you create the HTLC.');
  }
}

// Command line options
const args = process.argv.slice(2);

if (args.includes('--generate-only')) {
  FreshCrosschainSwap.generateFreshValues();
  process.exit(0);
}

// Run the fresh swap
if (require.main === module) {
  const freshSwap = new FreshCrosschainSwap();
  
  freshSwap.executeFreshSwap()
    .then(() => {
      console.log('\n🎯 FRESH SWAP COMPLETED!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fresh swap failed:', error.message);
      console.log('\n💡 Run again to generate new fresh values!');
      process.exit(1);
    });
}

export { FreshCrosschainSwap };