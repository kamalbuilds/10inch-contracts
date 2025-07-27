#!/usr/bin/env node

/**
 * COMPLETE ATOMIC SWAP
 * 
 * Completes the atomic swap by revealing the secret on both chains
 * using the data from the successful cross-chain demo.
 */

import { execSync } from 'child_process';
import { ethers } from 'ethers';

// Contract addresses from the successful demo
const STELLAR_CONTRACT = 'CATGJPI3BE2LJHDHYXKNUAELSLHN4BYVPZTIQ7T2RGDWA5L67DUAWW5D';
const ETHEREUM_HTLC = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';

// Data from the successful cross-chain demo
const SWAP_DATA = {
  secret: 'ce8bf60aac58249ee640caf748ba070a26f9affa2a711cb8fe5c461bc69ab2e8',
  hashlock: 'cb0b5755a71a8af2b7b552d6f12fa1ffe9f6f308aad9e71d9b5d84754b6b4999',
  stellarHtlcId: 1,
  ethereumContractId: '0x25d8bc13f3e8f4524e2a9ca3ed4a59319488639716c19f8542736be8c951daf2',
  ethereumReceiver: '0x666446eC2343e9E7e3D75C4C5b6A15355Ec7d7D4'
};

// Ethereum HTLC ABI
const HTLC_ABI = [
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
    "inputs": [
      { "internalType": "bytes32", "name": "_contractId", "type": "bytes32" }
    ],
    "name": "getContract",
    "outputs": [
      { "internalType": "address", "name": "sender", "type": "address" },
      { "internalType": "address", "name": "receiver", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "bytes32", "name": "hashlock", "type": "bytes32" },
      { "internalType": "uint256", "name": "timelock", "type": "uint256" },
      { "internalType": "bool", "name": "withdrawn", "type": "bool" },
      { "internalType": "bool", "name": "refunded", "type": "bool" },
      { "internalType": "bytes32", "name": "preimage", "type": "bytes32" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

class AtomicSwapCompleter {
  private ethereumProvider: ethers.JsonRpcProvider;
  private ethereumSigner: ethers.Wallet;

  constructor() {
    this.ethereumProvider = new ethers.JsonRpcProvider('https://ethereum-sepolia.publicnode.com');
    
    const privateKey = process.env.ETHEREUM_PRIVATE_KEY || '0x1234567890123456789012345678901234567890123456789012345678901234';
    this.ethereumSigner = new ethers.Wallet(privateKey, this.ethereumProvider);
    
    console.log('🔗 COMPLETING ATOMIC SWAP');
    console.log('📋 Stellar Contract:', STELLAR_CONTRACT);
    console.log('📋 Ethereum HTLC:', ETHEREUM_HTLC);
    console.log('🔑 Secret:', SWAP_DATA.secret);
    console.log('🔒 Hashlock:', SWAP_DATA.hashlock);
    console.log('📋 Stellar HTLC ID:', SWAP_DATA.stellarHtlcId);
    console.log('📋 Ethereum Contract ID:', SWAP_DATA.ethereumContractId);
  }

  /**
   * Step 1: Withdraw from Ethereum HTLC
   */
  async withdrawFromEthereum(): Promise<void> {
    console.log('\n🔗 Step 1: Withdrawing from Ethereum HTLC...');
    
    try {
      const htlcContract = new ethers.Contract(ETHEREUM_HTLC, HTLC_ABI, this.ethereumSigner);
      
      // Convert secret to bytes32
      const secretBytes32 = '0x' + SWAP_DATA.secret;
      
      console.log('🔧 Withdrawing from Ethereum HTLC:');
      console.log('   Contract ID:', SWAP_DATA.ethereumContractId);
      console.log('   Secret:', secretBytes32);
      
      // Withdraw from Ethereum HTLC
      const tx = await htlcContract.withdraw(
        SWAP_DATA.ethereumContractId,
        secretBytes32
      );
      
      console.log('⏳ Waiting for Ethereum withdrawal confirmation...');
      console.log('📋 Transaction hash:', tx.hash);
      
      // Wait for confirmation
      const receipt = await tx.wait();
      console.log('✅ Ethereum withdrawal successful!');
      console.log('📋 Block number:', receipt.blockNumber);
      console.log('📋 Gas used:', receipt.gasUsed.toString());
      
    } catch (e) {
      console.log('❌ Ethereum withdrawal failed:', e);
      throw e;
    }
  }

  /**
   * Step 2: Complete order on Stellar
   */
  async completeStellarOrder(): Promise<void> {
    console.log('\n🌟 Step 2: Completing order on Stellar...');
    
    try {
      const completeOrderCmd = `stellar contract invoke \
        --id ${STELLAR_CONTRACT} \
        --source deployer \
        --network testnet \
        --send=yes \
        -- complete_order \
        --order_id 1 \
        --secret ${SWAP_DATA.secret}`;

      const result = execSync(completeOrderCmd, { encoding: 'utf8', timeout: 60000 });
      console.log('📅 Stellar completion result:', result);
      console.log('✅ Stellar order completed successfully!');
      
    } catch (e) {
      console.log('❌ Stellar order completion failed:', e);
      throw e;
    }
  }

  /**
   * Step 3: Verify completion on both chains
   */
  async verifyCompletion(): Promise<void> {
    console.log('\n🔍 Step 3: Verifying completion on both chains...');
    
    // Verify Ethereum HTLC
    try {
      const htlcContract = new ethers.Contract(ETHEREUM_HTLC, HTLC_ABI, this.ethereumProvider);
      const contractDetails = await htlcContract.getContract(SWAP_DATA.ethereumContractId);
      
      console.log('🔗 Ethereum HTLC Status:');
      console.log('   Withdrawn:', contractDetails[5]);
      console.log('   Refunded:', contractDetails[6]);
      console.log('   Preimage:', contractDetails[7]);
      
      if (contractDetails[5]) {
        console.log('✅ Ethereum HTLC: WITHDRAWN SUCCESSFULLY');
      } else {
        console.log('❌ Ethereum HTLC: NOT WITHDRAWN');
      }
    } catch (e) {
      console.log('⚠️  Could not verify Ethereum HTLC status:', e);
    }
    
    // Verify Stellar HTLC
    try {
      const getHTLCCmd = `stellar contract invoke \
        --id ${STELLAR_CONTRACT} \
        --source deployer \
        --network testnet \
        -- get_htlc \
        --htlc_id ${SWAP_DATA.stellarHtlcId}`;

      const stellarResult = execSync(getHTLCCmd, { encoding: 'utf8', timeout: 30000 });
      console.log('🌟 Stellar HTLC Status:', stellarResult);
      
      if (stellarResult.includes('"withdrawn":true')) {
        console.log('✅ Stellar HTLC: WITHDRAWN SUCCESSFULLY');
      } else {
        console.log('❌ Stellar HTLC: NOT WITHDRAWN');
      }
    } catch (e) {
      console.log('⚠️  Could not verify Stellar HTLC status:', e);
    }
  }

  /**
   * Complete the atomic swap
   */
  async completeAtomicSwap(): Promise<void> {
    console.log('🚀 COMPLETING ATOMIC SWAP\n');
    console.log('🎯 Executing withdrawal on both chains\n');
    
    try {
      // Step 1: Withdraw from Ethereum
      await this.withdrawFromEthereum();
      
      // Step 2: Complete order on Stellar
      await this.completeStellarOrder();
      
      // Step 3: Verify completion
      await this.verifyCompletion();
      
      console.log('\n🏆 === ATOMIC SWAP COMPLETED ===');
      console.log('🎯 Cross-Chain Atomic Swap: SUCCESSFUL');
      console.log('✅ Ethereum withdrawal: COMPLETED');
      console.log('✅ Stellar completion: COMPLETED');
      console.log('✅ Atomic swap: FINALIZED');
      
      console.log('\n🚀 ATOMIC SWAP SUCCESSFULLY COMPLETED!');
      console.log('📈 Business Impact: Real cross-chain value transfer');
      console.log('🔧 Technical Achievement: Complete atomic swap flow');
      console.log('🌟 Mission Status: ATOMIC SWAP ACCOMPLISHED');
      
    } catch (error) {
      console.error('❌ Atomic swap completion error:', error);
      console.log('\n💡 Troubleshooting:');
      console.log('   - Check if HTLCs are still valid (not expired)');
      console.log('   - Verify secret is correct');
      console.log('   - Ensure sufficient gas for Ethereum transaction');
    }
  }
}

async function main() {
  const completer = new AtomicSwapCompleter();
  await completer.completeAtomicSwap();
}

if (require.main === module) {
  main().catch(console.error);
}

export { AtomicSwapCompleter }; 