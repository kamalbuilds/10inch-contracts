import { mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV4, Address } from '@ton/ton';
import { toNano, beginCell } from '@ton/core';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import { compile } from '@ton/blueprint';
import * as fs from 'fs';
import * as path from 'path';

// Add delay function for rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function deploy() {
    // Use Chainstack testnet endpoint with v2 API
    const endpoint = 'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac55b0/api/v2/jsonRPC';
    
    const mnemonic = 'quick price intact trend betray leisure inch daring fragile improve example believe because island tent will exist country robust knife onion dust skill loan'.split(' ');
    
    console.log('🚀 Starting Fusion HTLC deployment...\n');
    console.log('Using Chainstack RPC endpoint\n');
    
    try {
        // Initialize client with Chainstack endpoint
        const client = new TonClient({ 
            endpoint,
            timeout: 60000
        });
        
        // Initialize wallet
        const keyPair = await mnemonicToPrivateKey(mnemonic);
        const wallet = WalletContractV4.create({
            workchain: 0,
            publicKey: keyPair.publicKey,
        });
        
        console.log('📱 Wallet address:', wallet.address.toString());
        
        // Small delay before checking balance
        await delay(1000);
        
        // Check balance
        const walletContract = client.open(wallet);
        const balance = await walletContract.getBalance();
        console.log('💰 Balance:', balance / 1000000000n, 'TON\n');
        
        if (balance < toNano('0.1')) {
            console.error('❌ Insufficient balance. Need at least 0.1 TON');
            console.log('🔗 Get testnet TON from: https://t.me/testgiver_ton_bot');
            return;
        }
        
        // Compile contract
        console.log('📦 Compiling contract...');
        const code = await compile('FusionHTLC');
        
        // Create contract
        const htlc = FusionHTLC.createFromConfig(
            {
                id: Math.floor(Math.random() * 10000),
                code,
                data: beginCell().endCell(),
            },
            code
        );
        
        console.log('📄 Contract address:', htlc.address.toString());
        
        // Deploy
        console.log('\n🔨 Deploying...');
        const contract = client.open(htlc);
        
        await delay(2000); // Small delay before deployment
        
        await contract.sendDeploy(
            walletContract.sender(keyPair.secretKey),
            toNano('0.05')
        );
        
        // Wait for deployment
        console.log('⏳ Waiting for deployment...');
        let deployed = false;
        let attempts = 0;
        
        while (!deployed && attempts < 30) {
            await delay(3000);
            try {
                await contract.getNextHTLCId();
                deployed = true;
            } catch (e) {
                // Contract not yet deployed
                process.stdout.write('.');
                attempts++;
            }
        }
        
        if (deployed) {
            console.log('\n\n✅ Contract deployed successfully!');
            
            // Save deployment info
            const deploymentInfo = {
                address: htlc.address.toString(),
                deployedAt: new Date().toISOString(),
                network: 'testnet',
                walletAddress: wallet.address.toString()
            };
            
            const deploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
            fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
            
            console.log('\n📋 Deployment info saved to:', deploymentPath);
            console.log('Contract Address:', htlc.address.toString());
        } else {
            console.error('\n❌ Deployment timeout');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

deploy().catch(console.error);