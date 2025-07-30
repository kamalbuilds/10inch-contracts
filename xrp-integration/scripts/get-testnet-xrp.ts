import { XRPFusionClient } from '../src/xrp-fusion-client';
import * as dotenv from 'dotenv';

dotenv.config();

async function getTestnetXRP() {
    console.log('💰 Getting Testnet XRP\n');
    
    try {
        const xrpSeed = process.env.XRP_SEED;
        if (!xrpSeed) {
            console.error('❌ Please set XRP_SEED in .env file');
            return;
        }
        
        // Initialize client
        const xrpClient = new XRPFusionClient('wss://s.altnet.rippletest.net:51233');
        await xrpClient.init(xrpSeed);
        
        const address = xrpClient.getWalletAddress();
        console.log('📍 Your XRP Address:', address);
        
        // Check current balance
        const balance = await xrpClient.getBalance();
        console.log('💰 Current Balance:', balance, 'XRP');
        
        if (parseFloat(balance) >= 100) {
            console.log('✅ You already have sufficient XRP!');
            return;
        }
        
        console.log('\n🚰 Getting XRP from faucet...');
        console.log('Please visit: https://xrpl.org/xrp-testnet-faucet.html');
        console.log('And enter your address:', address);
        console.log('\nAlternatively, you can use these faucets:');
        console.log('1. https://faucet.altnet.rippletest.net/accounts');
        console.log('2. https://test.bithomp.com/faucet/');
        
        // Try automatic faucet request (may not always work)
        console.log('\n🔄 Attempting automatic faucet request...');
        try {
            const response = await fetch('https://faucet.altnet.rippletest.net/accounts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    destination: address,
                    userAgent: 'xrp-integration-test'
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('✅ Faucet request successful!');
                console.log('Transaction:', result);
                
                // Wait for balance to update
                console.log('\n⏳ Waiting for balance update...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const newBalance = await xrpClient.getBalance();
                console.log('💰 New Balance:', newBalance, 'XRP');
            } else {
                console.log('❌ Automatic faucet request failed. Please use manual method.');
            }
        } catch (error) {
            console.log('⚠️  Automatic faucet not available. Please use manual method.');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

getTestnetXRP().catch(console.error);