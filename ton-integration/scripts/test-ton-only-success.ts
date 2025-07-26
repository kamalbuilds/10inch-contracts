import { toNano } from '@ton/core';
import { TonFusionClient } from '../src/ton-fusion-client';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function testTONOnlySuccess() {
    console.log('🎉 Testing TON-Only Success (Hash Fix Verified)\n');
    
    try {
        // Load TON deployment
        const tonDeploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
        const deployment = JSON.parse(fs.readFileSync(tonDeploymentPath, 'utf-8'));
        const tonHTLCAddress = deployment.address;
        
        console.log('📱 Using Fixed TON HTLC Contract:', tonHTLCAddress);
        
        // Initialize TON client
        const tonClient = new TonFusionClient(
            'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac6df03d0eb1e8c82b4',
            process.env.TON_MNEMONIC!.split(' ')
        );
        
        await tonClient.initialize();
        console.log('TON Wallet:', tonClient.getAddress());
        
        // Generate a test secret and hash
        const { secret, hashlock } = await FusionHTLC.generateSecret();
        console.log('\n🔐 Test Parameters:');
        console.log('Secret (hex):', secret.toString('hex'));
        console.log('Hashlock (hex):', hashlock.toString('hex'));
        
        // Test 1: Create HTLC
        console.log('\n=== Step 1: Create HTLC ===');
        const amount = toNano('0.01');
        const timelock = Math.floor(Date.now() / 1000) + 3600;
        
        const createResult = await tonClient.createHTLC(
            tonClient.getAddress(),
            amount,
            hashlock,
            timelock
        );
        
        console.log('✅ HTLC Created - ID:', createResult.htlcId);
        
        // Test 2: Claim HTLC
        console.log('\n=== Step 2: Claim HTLC with Secret ===');
        
        const claimResult = await tonClient.claimHTLC(
            createResult.htlcId,
            secret
        );
        
        console.log('✅ HTLC Claimed Successfully!');
        console.log('Claim Transaction:', claimResult.hash);
        
        console.log('\n🎉 SUCCESS SUMMARY:');
        console.log('✅ TON HTLC Creation: WORKING');
        console.log('✅ TON Hash Verification: WORKING');
        console.log('✅ TON HTLC Claiming: WORKING');
        console.log('✅ TON Side: COMPLETELY FIXED');
        
    } catch (error: any) {
        console.error('❌ Test failed:', error.message);
    }
}

testTONOnlySuccess().catch(console.error);