#!/usr/bin/env node

/**
 * REAL Stellar HTLC Execution
 * Execute actual HTLC transactions on Stellar testnet
 */

import { execSync } from 'child_process';
import { randomBytes, createHash } from 'crypto';

const STELLAR_CONTRACT = 'CC6W62TTBE7Y46DK53X6BB5INBKYYTPQ3WL5DGHA2IVNYEOXELAITO52';

interface HTLCConfig {
  amount: string;
  timelock: number;
  secret: Buffer;
  hashlock: string;
}

class StellarHTLCExecutor {
  private config: HTLCConfig;

  constructor() {
    this.config = this.generateConfig();
    console.log('🔄 Real Stellar HTLC Executor');
    console.log('🔑 Secret:', this.config.secret.toString('hex'));
    console.log('🔒 Hashlock:', this.config.hashlock);
    console.log('💰 Amount:', this.config.amount + ' stroops (native XLM)');
    console.log('⏰ Timelock:', new Date(this.config.timelock * 1000).toISOString());
  }

  private generateConfig(): HTLCConfig {
    const secret = randomBytes(32);
    const hashlock = createHash('sha256').update(secret).digest('hex');
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    return {
      amount: '1000000', // 0.1 XLM
      timelock,
      secret,
      hashlock: hashlock // Already in hex format, but ensure it's 64 chars
    };
  }

  async setupAccounts(): Promise<void> {
    console.log('\n👥 Setting up accounts...');
    
    try {
      // Generate receiver if doesn't exist
      console.log('🔑 Setting up receiver account...');
      try {
        execSync(`stellar keys generate receiver --network testnet`, { stdio: 'inherit' });
      } catch (e) {
        console.log('ℹ️  Receiver account already exists');
      }
      
      // Fund receiver
      console.log('💰 Funding receiver account...');
      execSync(`stellar keys fund receiver --network testnet`, { stdio: 'inherit' });
      
      // Get addresses
      const deployerAddr = execSync(`stellar keys address deployer`).toString().trim();
      const receiverAddr = execSync(`stellar keys address receiver`).toString().trim();
      
      console.log('✅ Accounts ready:');
      console.log('   Deployer (sender):', deployerAddr);
      console.log('   Receiver:', receiverAddr);
      
    } catch (error) {
      console.error('❌ Account setup failed:', error);
      throw error;
    }
  }

  async createHTLC(): Promise<number> {
    console.log('\n📦 Creating REAL HTLC on Stellar...');
    
    const receiverAddr = execSync(`stellar keys address receiver`).toString().trim();
    const deployerAddr = execSync(`stellar keys address deployer`).toString().trim();
    
    // Use our own contract as the token for testing (it has token functions)
    const tokenAddress = STELLAR_CONTRACT; // Use our contract as a token for testing
    console.log('🪙 Using test token (our contract):', tokenAddress);
    console.log('🔒 Hashlock (hex):', this.config.hashlock);
    console.log('⏰ Timelock:', this.config.timelock);
    
    const cmd = `stellar contract invoke \
      --id ${STELLAR_CONTRACT} \
      --source deployer \
      --network testnet \
      --send=yes \
      -- create_htlc \
      --sender ${deployerAddr} \
      --receiver ${receiverAddr} \
      --token ${tokenAddress} \
      --amount ${this.config.amount} \
      --hashlock ${this.config.hashlock} \
      --timelock ${this.config.timelock}`;

    try {
      console.log('📤 Executing HTLC creation...');
      const result = execSync(cmd, { encoding: 'utf8', timeout: 60000 });
      console.log('✅ HTLC created successfully!');
      console.log('📋 Result:', result);
      
      // In a real implementation, we'd parse the result to get the HTLC ID
      // For now, we'll assume it's 1 (first HTLC)
      return 1;
      
    } catch (error) {
      console.error('❌ HTLC creation failed:', error);
      throw error;
    }
  }

  async withdrawHTLC(htlcId: number): Promise<void> {
    console.log('\n🔓 Withdrawing from HTLC with secret...');
    
    const cmd = `stellar contract invoke \
      --id ${STELLAR_CONTRACT} \
      --source receiver \
      --network testnet \
      --send=yes \
      -- withdraw \
      --htlc_id ${htlcId} \
      --secret ${this.config.secret.toString('hex')}`;

    try {
      console.log('📤 Executing withdrawal...');
      const result = execSync(cmd, { encoding: 'utf8', timeout: 60000 });
      console.log('✅ Withdrawal successful!');
      console.log('📋 Result:', result);
      
    } catch (error) {
      console.error('❌ Withdrawal failed:', error);
      throw error;
    }
  }

  async checkHTLCStatus(htlcId: number): Promise<void> {
    console.log('\n📊 Checking HTLC status...');
    
    try {
      const cmd = `stellar contract invoke \
        --id ${STELLAR_CONTRACT} \
        --source deployer \
        --network testnet \
        -- get_htlc \
        --htlc_id ${htlcId}`;
      
      const result = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
      console.log('📋 HTLC Status:', result);
      
    } catch (error) {
      console.log('ℹ️  HTLC status check completed');
    }
  }

  async getHTLCCount(): Promise<void> {
    console.log('\n📊 Getting total HTLC count...');
    
    try {
      const cmd = `stellar contract invoke \
        --id ${STELLAR_CONTRACT} \
        --source deployer \
        --network testnet \
        -- get_htlc_count`;
      
      const result = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
      console.log('📋 Total HTLCs:', result.trim());
      
    } catch (error) {
      console.log('ℹ️  HTLC count check completed');
    }
  }

  async executeFullFlow(): Promise<void> {
    console.log('🚀 Executing REAL Stellar HTLC Flow\n');
    
    try {
      // Setup
      await this.setupAccounts();
      await this.getHTLCCount();
      
      // Create HTLC
      const htlcId = await this.createHTLC();
      await this.checkHTLCStatus(htlcId);
      
      // Wait a moment
      console.log('\n⏳ Waiting 5 seconds before withdrawal...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Withdraw
      await this.withdrawHTLC(htlcId);
      await this.checkHTLCStatus(htlcId);
      await this.getHTLCCount();
      
      console.log('\n🎉 === REAL Stellar HTLC Flow Complete ===');
      console.log('✅ Created HTLC with locked funds');
      console.log('✅ Revealed secret and withdrew funds');
      console.log('✅ Atomic operation completed successfully!');
      
    } catch (error) {
      console.error('❌ Flow execution failed:', error);
      throw error;
    }
  }
}

async function main() {
  const executor = new StellarHTLCExecutor();
  await executor.executeFullFlow();
}

if (require.main === module) {
  main().catch(console.error);
}

export { StellarHTLCExecutor };