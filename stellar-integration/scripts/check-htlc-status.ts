#!/usr/bin/env node

/**
 * CHECK HTLC STATUS
 * 
 * Checks the current status of both Stellar and Ethereum HTLCs
 * to understand what hashlock and secret are actually stored.
 */

import { execSync } from 'child_process';
import { ethers } from 'ethers';

// Contract addresses
const STELLAR_CONTRACT = 'CATGJPI3BE2LJHDHYXKNUAELSLHN4BYVPZTIQ7T2RGDWA5L67DUAWW5D';
const ETHEREUM_HTLC = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';

// Data from the demo
const SWAP_DATA = {
  secret: 'ce8bf60aac58249ee640caf748ba070a26f9affa2a711cb8fe5c461bc69ab2e8',
  hashlock: 'cb0b5755a71a8af2b7b552d6f12fa1ffe9f6f308aad9e71d9b5d84754b6b4999',
  stellarHtlcId: 1,
  ethereumContractId: '0x25d8bc13f3e8f4524e2a9ca3ed4a59319488639716c19f8542736be8c951daf2'
};

// Ethereum HTLC ABI
const HTLC_ABI = [
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

class HTLCStatusChecker {
  private ethereumProvider: ethers.JsonRpcProvider;

  constructor() {
    this.ethereumProvider = new ethers.JsonRpcProvider('https://ethereum-sepolia.publicnode.com');
    
    console.log('🔍 CHECKING HTLC STATUS');
    console.log('📋 Stellar Contract:', STELLAR_CONTRACT);
    console.log('📋 Ethereum HTLC:', ETHEREUM_HTLC);
    console.log('📋 Ethereum Contract ID:', SWAP_DATA.ethereumContractId);
  }

  /**
   * Check Ethereum HTLC status
   */
  async checkEthereumHTLC(): Promise<void> {
    console.log('\n🔗 Checking Ethereum HTLC Status...');
    
    try {
      const htlcContract = new ethers.Contract(ETHEREUM_HTLC, HTLC_ABI, this.ethereumProvider);
      const contractDetails = await htlcContract.getContract(SWAP_DATA.ethereumContractId);
      
      console.log('🔗 Ethereum HTLC Details:');
      console.log('   Sender:', contractDetails[0]);
      console.log('   Receiver:', contractDetails[1]);
      console.log('   Amount:', ethers.formatEther(contractDetails[2]), 'ETH');
      console.log('   Hashlock:', contractDetails[3]);
      console.log('   Timelock:', new Date(Number(contractDetails[4]) * 1000).toISOString());
      console.log('   Withdrawn:', contractDetails[5]);
      console.log('   Refunded:', contractDetails[6]);
      console.log('   Preimage:', contractDetails[7]);
      
      // Check if our hashlock matches
      const expectedHashlock = '0x' + SWAP_DATA.hashlock;
      const actualHashlock = contractDetails[3];
      
      console.log('\n🔍 Hashlock Comparison:');
      console.log('   Expected:', expectedHashlock);
      console.log('   Actual:  ', actualHashlock);
      console.log('   Match:   ', expectedHashlock === actualHashlock ? '✅ YES' : '❌ NO');
      
      if (expectedHashlock !== actualHashlock) {
        console.log('\n⚠️  HASHLOCK MISMATCH DETECTED!');
        console.log('   The Ethereum HTLC was created with a different hashlock than expected.');
        console.log('   This means the secret from the demo is not compatible with this HTLC.');
      }
      
    } catch (e) {
      console.log('❌ Could not check Ethereum HTLC status:', e);
    }
  }

  /**
   * Check Stellar HTLC status
   */
  async checkStellarHTLC(): Promise<void> {
    console.log('\n🌟 Checking Stellar HTLC Status...');
    
    try {
      const getHTLCCmd = `stellar contract invoke \
        --id ${STELLAR_CONTRACT} \
        --source deployer \
        --network testnet \
        -- get_htlc \
        --htlc_id ${SWAP_DATA.stellarHtlcId}`;

      const stellarResult = execSync(getHTLCCmd, { encoding: 'utf8', timeout: 30000 });
      console.log('🌟 Stellar HTLC Details:');
      console.log(stellarResult);
      
      // Check if our hashlock matches
      if (stellarResult.includes(SWAP_DATA.hashlock)) {
        console.log('✅ Stellar hashlock matches expected value');
      } else {
        console.log('❌ Stellar hashlock does not match expected value');
      }
      
    } catch (e) {
      console.log('❌ Could not check Stellar HTLC status:', e);
    }
  }

  /**
   * Verify secret-hashlock relationship
   */
  async verifySecretHashlock(): Promise<void> {
    console.log('\n🔐 Verifying Secret-Hashlock Relationship...');
    
    const { createHash } = require('crypto');
    const secretBuffer = Buffer.from(SWAP_DATA.secret, 'hex');
    const calculatedHashlock = createHash('sha256').update(secretBuffer).digest('hex');
    
    console.log('🔐 Secret-Hashlock Verification:');
    console.log('   Secret:', SWAP_DATA.secret);
    console.log('   Calculated Hashlock:', calculatedHashlock);
    console.log('   Expected Hashlock:', SWAP_DATA.hashlock);
    console.log('   Match:', calculatedHashlock === SWAP_DATA.hashlock ? '✅ YES' : '❌ NO');
    
    if (calculatedHashlock !== SWAP_DATA.hashlock) {
      console.log('\n⚠️  SECRET-HASHLOCK MISMATCH!');
      console.log('   The secret does not produce the expected hashlock.');
      console.log('   This indicates the secret or hashlock data is incorrect.');
    }
  }

  /**
   * Check both HTLCs
   */
  async checkBothHTLCs(): Promise<void> {
    console.log('🔍 CHECKING BOTH HTLC STATUSES\n');
    
    try {
      await this.checkEthereumHTLC();
      await this.checkStellarHTLC();
      await this.verifySecretHashlock();
      
      console.log('\n🏆 === HTLC STATUS CHECK COMPLETE ===');
      console.log('🔍 Both HTLCs have been checked');
      console.log('📊 Status information displayed above');
      
    } catch (error) {
      console.error('❌ HTLC status check error:', error);
    }
  }
}

async function main() {
  const checker = new HTLCStatusChecker();
  await checker.checkBothHTLCs();
}

if (require.main === module) {
  main().catch(console.error);
}

export { HTLCStatusChecker }; 