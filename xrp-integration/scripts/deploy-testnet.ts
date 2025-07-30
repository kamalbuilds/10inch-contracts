import { XRPFusionClient } from '../src/xrp-fusion-client';
import { XRPHTLC } from '../src/xrp-htlc';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function deployTestnet() {
    console.log('🚀 Deploying XRP Integration to Testnet\n');
    
    try {
        // Initialize XRP client - try different testnet server
        const xrpClient = new XRPFusionClient('wss://testnet.xrpl-labs.com');
        
        // Check if we have a seed in env
        const seed = process.env.XRP_SEED;
        
        if (seed) {
            console.log('Using existing wallet from seed');
            await xrpClient.init(seed);
        } else {
            console.log('Generating new wallet...');
            await xrpClient.init();
            console.log('\n⚠️  Save this seed in your .env file as XRP_SEED:');
            console.log('Seed:', (xrpClient as any).wallet.seed);
        }
        
        const address = xrpClient.getWalletAddress();
        console.log('\n📍 XRP Wallet Address:', address);
        
        // Check balance
        const balance = await xrpClient.getBalance();
        console.log('💰 Balance:', balance, 'XRP');
        
        if (parseFloat(balance) === 0) {
            console.log('\n⚠️  Your wallet has no XRP!');
            console.log('Get testnet XRP from: https://xrpl.org/xrp-testnet-faucet.html');
            console.log('Use this address:', address);
            return;
        }
        
        // Test HTLC creation
        console.log('\n🧪 Testing HTLC creation...');
        
        const { secret, hashlock } = XRPHTLC.generateSecret();
        // XRP uses seconds since Ripple epoch (2000-01-01 00:00:00 UTC)
        const rippleEpoch = 946684800; // Unix timestamp of Ripple epoch
        const currentUnixTime = Math.floor(Date.now() / 1000);
        const rippleTime = currentUnixTime - rippleEpoch;
        const timelock = rippleTime + 3600; // 1 hour from now in Ripple time
        
        const result = await xrpClient.createHTLC({
            receiver: address, // Send to self for testing
            amount: '1', // 1 XRP
            hashlock,
            timelock
        });
        
        if (result.success) {
            console.log('✅ Test HTLC created successfully!');
            console.log('Escrow Sequence:', result.escrowSequence);
            
            // Save deployment info
            const deployment = {
                network: 'testnet',
                walletAddress: address,
                rpcUrl: 'wss://testnet.xrpl-labs.com',
                testEscrowSequence: result.escrowSequence,
                deployedAt: new Date().toISOString()
            };
            
            fs.writeFileSync(
                path.join(__dirname, '..', 'deployment-testnet.json'),
                JSON.stringify(deployment, null, 2)
            );
            
            console.log('\n✅ Deployment info saved to deployment-testnet.json');
            
            // Test claiming
            console.log('\n🔓 Testing HTLC claim...');
            const claimResult = await xrpClient.claimHTLC(
                address,
                result.escrowSequence!,
                secret
            );
            
            if (claimResult.success) {
                console.log('✅ HTLC claimed successfully!');
                console.log('Transaction:', claimResult.txHash);
            }
            
        } else {
            console.error('❌ Failed to create HTLC:', result.error);
            console.error('Full result:', result);
        }
        
        console.log('\n🎉 XRP integration deployed and tested successfully!');
        
    } catch (error) {
        console.error('❌ Deployment failed:', error);
    }
}

deployTestnet().catch(console.error);