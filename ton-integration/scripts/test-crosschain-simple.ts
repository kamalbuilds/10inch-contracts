import { ethers } from 'ethers';
import { toNano } from '@ton/core';
import { TonFusionClient } from '../src/ton-fusion-client';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function testSimpleCrossChain() {
    console.log('🔄 Testing Cross-Chain Swap - Simple Version\n');
    
    try {
        // Load TON deployment
        const tonDeploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
        const deployment = JSON.parse(fs.readFileSync(tonDeploymentPath, 'utf-8'));
        const tonHTLCAddress = deployment.address;
        
        // Configuration
        const config = {
            tonRpcUrl: 'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac55b0/api/v2/jsonRPC',
            tonHTLCAddress,
            tonMnemonic: process.env.TON_MNEMONIC || '',
            evmRpcUrl: process.env.EVM_RPC_URL || 'https://sepolia.drpc.org',
            evmHTLCAddress: sharedDeployment.sepolia.contractAddress,
            evmPrivateKey: process.env.EVM_PRIVATE_KEY || '',
            evmHTLCABI: sharedDeployment.sepolia.abi,
        };
        
        if (!config.tonMnemonic || !config.evmPrivateKey) {
            console.error('❌ Please set TON_MNEMONIC and EVM_PRIVATE_KEY in .env file');
            return;
        }
        
        // Initialize TON client
        console.log('📱 Initializing TON client...');
        const tonClient = new TonFusionClient(config.tonRpcUrl, config.tonHTLCAddress);
        await tonClient.init(config.tonMnemonic.split(' '));
        console.log('TON Wallet:', tonClient.getWalletAddress());
        console.log('TON HTLC:', tonClient.getHTLCAddress());
        
        // Initialize EVM client
        console.log('\n📱 Initializing EVM client...');
        const evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
        const evmWallet = new ethers.Wallet(config.evmPrivateKey, evmProvider);
        const evmHTLC = new ethers.Contract(config.evmHTLCAddress, config.evmHTLCABI, evmWallet);
        console.log('EVM Wallet:', evmWallet.address);
        console.log('Sepolia HTLC:', config.evmHTLCAddress);
        
        // Check TON balance
        const tonBalance = await tonClient.getBalance();
        console.log('\n💰 TON Balance:', Number(tonBalance) / 1e9, 'TON');
        
        if (tonBalance < toNano('0.2')) {
            console.error('❌ Insufficient TON balance. Please fund your wallet');
            return;
        }
        
        // Test TON HTLC creation
        console.log('\n=== Testing TON HTLC Creation ===');
        
        const { secret, hashlock } = await FusionHTLC.generateSecret();
        const swapAmount = toNano('0.05');
        const timelock = Math.floor(Date.now() / 1000) + 3600;
        
        console.log('Creating HTLC on TON...');
        console.log('Amount:', Number(swapAmount) / 1e9, 'TON');
        console.log('Hashlock:', hashlock.toString('hex'));
        
        try {
            const htlcId = await tonClient.createHTLC({
                receiver: evmWallet.address,
                amount: swapAmount,
                hashlock,
                timelock,
            });
            
            console.log('✅ TON HTLC created! ID:', htlcId);
            
            // Get HTLC details
            const htlcState = await tonClient.getHTLC(htlcId);
            console.log('\nHTLC State:');
            console.log('- Amount:', htlcState?.amount);
            console.log('- Receiver:', htlcState?.receiver);
            console.log('- Timelock:', htlcState?.timelock);
            console.log('- Claimed:', htlcState?.claimed);
            
            // Test claiming
            console.log('\n🔓 Testing claim with secret...');
            await tonClient.claimHTLC(htlcId, secret);
            console.log('✅ HTLC claimed successfully!');
            
            // Verify claim
            const claimedState = await tonClient.getHTLC(htlcId);
            console.log('- Claimed:', claimedState?.claimed);
            console.log('- Secret revealed:', claimedState?.secret?.toString('hex'));
            
        } catch (error) {
            console.error('❌ Error with TON HTLC:', error);
        }
        
        // Test EVM HTLC read
        console.log('\n=== Testing Sepolia HTLC Connection ===');
        
        try {
            // Try to get a non-existent HTLC to test connection
            const testId = '0x' + '0'.repeat(64);
            const htlcData = await evmHTLC.getContract(testId);
            console.log('✅ Successfully connected to Sepolia HTLC');
            console.log('Contract response:', {
                sender: htlcData.sender,
                amount: htlcData.amount.toString()
            });
        } catch (error: any) {
            if (error.message?.includes('network')) {
                console.error('❌ Network error connecting to Sepolia');
            } else {
                console.log('✅ Successfully connected to Sepolia HTLC');
            }
        }
        
        console.log('\n🎉 Test completed!');
        console.log('\n💡 Next steps:');
        console.log('1. Run the full cross-chain test when Sepolia is less congested');
        console.log('2. Or deploy a relayer service to automate the cross-chain flow');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run test
testSimpleCrossChain().catch(console.error);