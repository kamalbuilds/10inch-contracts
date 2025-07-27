#!/usr/bin/env node

/**
 * Create a test token for HTLC testing
 */

import { execSync } from 'child_process';

class TestTokenCreator {
  async createTestToken(): Promise<string> {
    console.log('🪙 Creating test token for HTLC...');
    
    try {
      // Create a test token contract using the Stellar Asset Contract
      console.log('📦 Deploying test token...');
      const adminAddress = execSync(`stellar keys address deployer`).toString().trim();
      
      // Create asset contract
      const result = execSync(`stellar contract asset deploy --asset native --source deployer --network testnet`, 
        { encoding: 'utf8', timeout: 60000 });
      
      console.log('✅ Test token deployed!');
      console.log('📋 Result:', result);
      
      // Extract contract address from result
      const lines = result.split('\n');
      let contractAddress = '';
      for (const line of lines) {
        if (line.includes('C') && line.length > 50) {
          contractAddress = line.trim();
          break;
        }
      }
      
      if (!contractAddress) {
        throw new Error('Could not extract contract address from deployment result');
      }
      
      console.log('🏷️  Token contract address:', contractAddress);
      return contractAddress;
      
    } catch (error) {
      console.error('❌ Test token creation failed:', error);
      throw error;
    }
  }

  async mintTokens(tokenAddress: string, amount: string): Promise<void> {
    console.log('🏦 Minting test tokens...');
    
    try {
      const deployerAddress = execSync(`stellar keys address deployer`).toString().trim();
      const receiverAddress = execSync(`stellar keys address receiver`).toString().trim();
      
      // Mint tokens to deployer (sender)
      console.log('💰 Minting tokens to deployer...');
      const mintCmd = `stellar contract invoke \
        --id ${tokenAddress} \
        --source deployer \
        --network testnet \
        --send=yes \
        -- mint \
        --to ${deployerAddress} \
        --amount ${amount}`;
      
      const result = execSync(mintCmd, { encoding: 'utf8', timeout: 60000 });
      console.log('✅ Tokens minted to deployer!');
      
      // Also mint some to receiver for testing
      console.log('💰 Minting tokens to receiver...');
      const mintCmd2 = `stellar contract invoke \
        --id ${tokenAddress} \
        --source deployer \
        --network testnet \
        --send=yes \
        -- mint \
        --to ${receiverAddress} \
        --amount ${amount}`;
      
      const result2 = execSync(mintCmd2, { encoding: 'utf8', timeout: 60000 });
      console.log('✅ Tokens minted to receiver!');
      
    } catch (error) {
      console.error('❌ Token minting failed:', error);
      // Continue anyway - we can test without minting
    }
  }

  async checkBalance(tokenAddress: string, accountAlias: string): Promise<void> {
    try {
      const accountAddress = execSync(`stellar keys address ${accountAlias}`).toString().trim();
      const balanceCmd = `stellar contract invoke \
        --id ${tokenAddress} \
        --source ${accountAlias} \
        --network testnet \
        -- balance \
        --id ${accountAddress}`;
      
      const balance = execSync(balanceCmd, { encoding: 'utf8', timeout: 30000 });
      console.log(`💰 ${accountAlias} balance:`, balance.trim());
      
    } catch (error) {
      console.log(`ℹ️  Could not check ${accountAlias} balance`);
    }
  }

  async setupTestToken(): Promise<string> {
    console.log('🚀 Setting up test token for HTLC testing\n');
    
    const tokenAddress = await this.createTestToken();
    await this.mintTokens(tokenAddress, '10000000000'); // 1000 tokens (with 7 decimals)
    
    console.log('\n📊 Checking balances...');
    await this.checkBalance(tokenAddress, 'deployer');
    await this.checkBalance(tokenAddress, 'receiver');
    
    console.log('\n✅ Test token setup complete!');
    console.log('🏷️  Token address:', tokenAddress);
    
    return tokenAddress;
  }
}

async function main() {
  const creator = new TestTokenCreator();
  const tokenAddress = await creator.setupTestToken();
  
  // Save to file for use in HTLC script
  const fs = require('fs');
  fs.writeFileSync('test-token-address.txt', tokenAddress);
  console.log('💾 Token address saved to test-token-address.txt');
}

if (require.main === module) {
  main().catch(console.error);
}

export { TestTokenCreator };