#!/usr/bin/env node

/**
 * TEST HASH FUNCTIONS
 * 
 * Tests different hash functions to understand what the Ethereum HTLC expects.
 */

import { ethers } from 'ethers';
import { createHash } from 'crypto';

// Data from the demo
const SECRET = 'ce8bf60aac58249ee640caf748ba070a26f9affa2a711cb8fe5c461bc69ab2e8';
const EXPECTED_HASHLOCK = 'cb0b5755a71a8af2b7b552d6f12fa1ffe9f6f308aad9e71d9b5d84754b6b4999';

class HashFunctionTester {
  constructor() {
    console.log('🔐 TESTING HASH FUNCTIONS');
    console.log('🔑 Secret:', SECRET);
    console.log('🔒 Expected Hashlock:', EXPECTED_HASHLOCK);
  }

  /**
   * Test SHA-256 (what we're currently using)
   */
  testSHA256(): void {
    console.log('\n🔐 Testing SHA-256:');
    const secretBuffer = Buffer.from(SECRET, 'hex');
    const hashlock = createHash('sha256').update(secretBuffer).digest('hex');
    console.log('   Hashlock:', hashlock);
    console.log('   Match:', hashlock === EXPECTED_HASHLOCK ? '✅ YES' : '❌ NO');
  }

  /**
   * Test Keccak256 (what Ethereum typically uses)
   */
  testKeccak256(): void {
    console.log('\n🔐 Testing Keccak256:');
    const secretBuffer = Buffer.from(SECRET, 'hex');
    const hashlock = ethers.keccak256(secretBuffer);
    console.log('   Hashlock:', hashlock);
    console.log('   Match:', hashlock === '0x' + EXPECTED_HASHLOCK ? '✅ YES' : '❌ NO');
  }

  /**
   * Test different secret formats
   */
  testDifferentFormats(): void {
    console.log('\n🔐 Testing Different Secret Formats:');
    
    // Test with 0x prefix
    const secretWithPrefix = '0x' + SECRET;
    const hashlockWithPrefix = ethers.keccak256(secretWithPrefix);
    console.log('   Secret with 0x prefix:', secretWithPrefix);
    console.log('   Keccak256 result:', hashlockWithPrefix);
    console.log('   Match:', hashlockWithPrefix === '0x' + EXPECTED_HASHLOCK ? '✅ YES' : '❌ NO');
    
    // Test with bytes32 format
    const secretBytes32 = ethers.zeroPadValue('0x' + SECRET, 32);
    const hashlockBytes32 = ethers.keccak256(secretBytes32);
    console.log('   Secret as bytes32:', secretBytes32);
    console.log('   Keccak256 result:', hashlockBytes32);
    console.log('   Match:', hashlockBytes32 === '0x' + EXPECTED_HASHLOCK ? '✅ YES' : '❌ NO');
  }

  /**
   * Test what the Ethereum HTLC might expect
   */
  testEthereumHTLCExpectation(): void {
    console.log('\n🔐 Testing Ethereum HTLC Expectations:');
    
    // The Ethereum HTLC might expect keccak256 of the secret
    const secretBuffer = Buffer.from(SECRET, 'hex');
    const keccakHashlock = ethers.keccak256(secretBuffer);
    
    console.log('   If Ethereum expects keccak256 of secret:');
    console.log('   Expected hashlock:', '0x' + EXPECTED_HASHLOCK);
    console.log('   Keccak256 of secret:', keccakHashlock);
    console.log('   Match:', keccakHashlock === '0x' + EXPECTED_HASHLOCK ? '✅ YES' : '❌ NO');
    
    if (keccakHashlock !== '0x' + EXPECTED_HASHLOCK) {
      console.log('\n💡 POSSIBLE SOLUTION:');
      console.log('   The Ethereum HTLC might expect keccak256 instead of SHA-256.');
      console.log('   We need to find the secret that produces the expected hashlock with keccak256.');
      
      // Try to find a secret that produces the expected hashlock with keccak256
      console.log('\n🔍 Attempting to find matching secret for keccak256...');
      this.findMatchingSecret();
    }
  }

  /**
   * Try to find a secret that produces the expected hashlock with keccak256
   */
  findMatchingSecret(): void {
    console.log('   This would require brute force or knowing the original secret used.');
    console.log('   For now, let\'s verify our current approach is correct.');
  }

  /**
   * Run all tests
   */
  runTests(): void {
    console.log('🔍 RUNNING HASH FUNCTION TESTS\n');
    
    this.testSHA256();
    this.testKeccak256();
    this.testDifferentFormats();
    this.testEthereumHTLCExpectation();
    
    console.log('\n🏆 === HASH FUNCTION TESTS COMPLETE ===');
    console.log('🔍 All hash functions have been tested');
    console.log('📊 Results displayed above');
  }
}

async function main() {
  const tester = new HashFunctionTester();
  tester.runTests();
}

if (require.main === module) {
  main().catch(console.error);
}

export { HashFunctionTester }; 