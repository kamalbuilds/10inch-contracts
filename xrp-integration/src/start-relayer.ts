import { XRPRelayer } from './xrp-relayer';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function startRelayer() {
    console.log('🚀 Starting XRP-EVM Relayer Service\n');
    
    // Check environment variables
    const xrpSeed = process.env.XRP_SEED;
    const evmPrivateKey = process.env.EVM_PRIVATE_KEY;
    
    if (!xrpSeed || !evmPrivateKey) {
        console.error('❌ Missing environment variables!');
        console.error('Please set XRP_SEED and EVM_PRIVATE_KEY in .env file');
        process.exit(1);
    }
    
    // Configure relayer
    const config = {
        xrpRpcUrl: process.env.XRP_RPC_URL || 'wss://s.altnet.rippletest.net:51233',
        evmRpcUrl: process.env.EVM_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/EQg9SpbyMVLhZ7QmhA7bJ_U_z9QIIeTQ',
        evmHTLCAddress: sharedDeployment.sepolia.contractAddress,
        evmHTLCABI: sharedDeployment.sepolia.abi,
        xrpSeed,
        evmPrivateKey
    };
    
    // Create and start relayer
    const relayer = new XRPRelayer(config);
    
    try {
        await relayer.start();
        
        console.log('\n📊 Relayer Configuration:');
        console.log('- XRP RPC:', config.xrpRpcUrl);
        console.log('- EVM RPC:', 'Sepolia via Alchemy');
        console.log('- EVM HTLC:', config.evmHTLCAddress);
        
        console.log('\n✅ Relayer is running. Press Ctrl+C to stop.\n');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down relayer...');
            await relayer.stop();
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Failed to start relayer:', error);
        process.exit(1);
    }
}

// Start the relayer
startRelayer().catch(console.error);