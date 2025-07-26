import { mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { toNano, beginCell } from '@ton/core';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import { compile } from '@ton/blueprint';
import * as fs from 'fs';
import * as path from 'path';

async function deployToTestnet() {
    // Configuration - Using alternative endpoint with better rate limits
    const endpoint = 'https://testnet.tonapi.io/v2';
    const apiKey = process.env.TON_API_KEY; // Optional API key for better rate limits
    
    // Generate or use existing mnemonic
    const mnemonic = process.env.TON_MNEMONIC?.split(' ') || [
        'quick', 'price', 'intact', 'trend', 'betray', 'leisure', 'inch', 'daring', 'fragile', 'improve', 'example', 'believe', 'because', 'island', 'tent', 'will', 'exist', 'country', 'robust', 'knife', 'onion', 'dust', 'skill', 'loan'
    ];
    
    console.log('🚀 Starting Fusion HTLC deployment to TON Testnet...\n');
    
    try {
        // Initialize client
        const client = new TonClient({
            endpoint,
            apiKey,
        });
        
        // Initialize wallet
        const keyPair = await mnemonicToPrivateKey(mnemonic);
        const wallet = WalletContractV4.create({
            workchain: 0,
            publicKey: keyPair.publicKey,
        });
        
        const walletContract = client.open(wallet);
        const walletSender = walletContract.sender(keyPair.secretKey);
        
        console.log('📱 Wallet address:', wallet.address.toString());
        
        // Check wallet balance
        const balance = await walletContract.getBalance();
        console.log('💰 Wallet balance:', balance / 1000000000n, 'TON');
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (balance < toNano('0.1')) {
            console.error('❌ Insufficient balance. Please fund your wallet with at least 0.1 TON');
            console.log('🔗 Get testnet TON from: https://testnet.ton.org/');
            return;
        }
        
        // Compile contract
        console.log('\n📦 Compiling Fusion HTLC contract...');
        const code = await compile('FusionHTLC');
        
        // Create contract instance
        const fusionHTLC = FusionHTLC.createFromConfig(
            {
                id: Math.floor(Math.random() * 10000),
                code,
                data: beginCell().endCell(),
            },
            code
        );
        
        const contractAddress = fusionHTLC.address;
        console.log('📄 Contract address:', contractAddress.toString());
        
        // Deploy contract
        console.log('\n🔨 Deploying contract...');
        const deployAmount = toNano('0.05');
        
        await fusionHTLC.sendDeploy(client.provider(contractAddress), walletSender, deployAmount);
        
        // Wait for deployment
        console.log('⏳ Waiting for deployment...');
        let deployed = false;
        let attempts = 0;
        
        while (!deployed && attempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const state = await client.provider(contractAddress).getState();
            if (state.state.type === 'active') {
                deployed = true;
            }
            attempts++;
        }
        
        if (!deployed) {
            console.error('❌ Deployment timeout');
            return;
        }
        
        console.log('✅ Contract deployed successfully!');
        
        // Verify deployment
        const nextId = await fusionHTLC.getNextHTLCId(client.provider(contractAddress));
        console.log('🔢 Next HTLC ID:', nextId);
        
        // Save deployment info
        const deploymentInfo = {
            network: 'testnet',
            contractAddress: contractAddress.toString(),
            walletAddress: wallet.address.toString(),
            deployedAt: new Date().toISOString(),
            deploymentTx: {
                amount: deployAmount.toString(),
            },
        };
        
        const deploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        
        console.log('\n📋 Deployment info saved to:', deploymentPath);
        console.log('\n🎉 Deployment complete!\n');
        console.log('Contract Address:', contractAddress.toString());
        console.log('To interact with the contract, use this address in your scripts.');
        
    } catch (error) {
        console.error('❌ Deployment failed:', error);
        process.exit(1);
    }
}

// Run deployment
deployToTestnet().catch(console.error);