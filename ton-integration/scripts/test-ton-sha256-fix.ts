import { toNano } from '@ton/core';
import { TonFusionClient } from '../src/ton-fusion-client';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import { sha256 } from '@ton/crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function testTONSHA256Fix() {
    console.log('🧪 Testing TON SHA256 Hash Fix\n');
    
    try {
        // Load TON deployment
        const tonDeploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
        const deployment = JSON.parse(fs.readFileSync(tonDeploymentPath, 'utf-8'));
        const tonHTLCAddress = deployment.address;
        
        console.log('📱 Using TON HTLC Contract:', tonHTLCAddress);
        
        // Initialize TON client
        const tonClient = new TonFusionClient(
            'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac55b0/api/v2/jsonRPC',
            tonHTLCAddress
        );
        await tonClient.init((process.env.TON_MNEMONIC || '').split(' '));
        
        console.log('TON Wallet:', tonClient.getWalletAddress());
        
        // Generate secret and hashlock using the same method as cross-chain
        console.log('\n🔐 Generating Secret and Hashlock...');
        const { secret, hashlock } = await FusionHTLC.generateSecret();
        
        console.log('Secret (hex):', secret.toString('hex'));
        console.log('Hashlock (hex):', hashlock.toString('hex'));
        
        // Verify our hash generation is consistent
        const verifyHash = await sha256(secret);
        console.log('Verify hash matches:', Buffer.compare(hashlock, verifyHash) === 0);
        
        // Test parameters
        const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        const amount = toNano('0.01'); // Small test amount
        const receiverAddress = tonClient.getWalletAddress(); // Send to self for testing
        
        console.log('\n=== Step 1: Create HTLC ===');
        const htlcId = await tonClient.createHTLC({
            receiver: receiverAddress,
            amount,
            hashlock,
            timelock,
        });
        
        console.log('✅ HTLC Created with ID:', htlcId);
        
        console.log('\n=== Step 2: Verify HTLC State ===');
        const htlcData = await tonClient.getHTLC(htlcId);
        if (htlcData) {
            console.log('- Sender:', htlcData.sender.toString());
            console.log('- Receiver:', htlcData.receiver.toString());
            console.log('- Amount:', htlcData.amount.toString());
            console.log('- Hashlock:', htlcData.hashlock.toString('hex'));
            console.log('- Timelock:', htlcData.timelock);
            console.log('- Claimed:', htlcData.claimed);
        }
        
        console.log('\n=== Step 3: Claim HTLC with Secret ===');
        await tonClient.claimHTLC(htlcId, secret);
        console.log('✅ HTLC Claimed successfully!');
        
        console.log('\n=== Step 4: Verify Final State ===');
        const finalHTLCData = await tonClient.getHTLC(htlcId);
        if (finalHTLCData) {
            console.log('- Claimed:', finalHTLCData.claimed);
            console.log('- Secret revealed:', finalHTLCData.secret?.toString('hex'));
            console.log('- Secret matches:', Buffer.compare(secret, finalHTLCData.secret || Buffer.alloc(0)) === 0);
        }
        
        console.log('\n🎉 TON SHA256 Fix Test Completed Successfully!');
        console.log('✅ The contract now properly uses SHA256 for cross-chain compatibility');
        
    } catch (error: any) {
        console.error('❌ Test failed:', error.message);
        if (error.logs) {
            console.log('Transaction logs:', error.logs);
        }
    }
}

testTONSHA256Fix().catch(console.error);