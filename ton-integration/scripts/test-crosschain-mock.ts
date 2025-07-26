import { ethers } from 'ethers';
import { toNano, Address } from '@ton/core';
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

async function testCrossChainSwapMock() {
    console.log('🔄 Testing Complete Cross-Chain Swap (TON ↔ Sepolia) - Mock Mode\n');
    console.log('ℹ️  This is a demonstration of the complete flow without actual blockchain transactions\n');
    
    try {
        // Load TON deployment info
        const tonDeploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
        let tonHTLCAddress: string;
        
        if (fs.existsSync(tonDeploymentPath)) {
            const deployment = JSON.parse(fs.readFileSync(tonDeploymentPath, 'utf-8'));
            tonHTLCAddress = deployment.address;
            console.log('✅ Found TON HTLC deployment at:', tonHTLCAddress);
        } else {
            console.error('❌ No TON deployment found. Please run deploy-testnet.ts first');
            return;
        }
        
        // Configuration
        const config = {
            tonHTLCAddress,
            evmHTLCAddress: sharedDeployment.sepolia.contractAddress,
        };
        
        console.log('📱 Configuration:');
        console.log('TON HTLC:', config.tonHTLCAddress);
        console.log('Sepolia HTLC:', config.evmHTLCAddress);
        
        console.log('\n=== DEMO: EVM → TON Swap ===');
        await demoEVMToTON();
        
        console.log('\n=== DEMO: TON → EVM Swap ===');
        await demoTONToEVM();
        
        console.log('\n📊 Complete Cross-Chain Swap Flow Summary:');
        console.log('1. User initiates swap on source chain (creates HTLC)');
        console.log('2. Resolver detects HTLC creation and validates parameters');
        console.log('3. Resolver creates corresponding HTLC on target chain');
        console.log('4. User claims on target chain by revealing secret');
        console.log('5. Resolver uses revealed secret to claim on source chain');
        console.log('6. Both HTLCs are settled, swap complete!');
        
        console.log('\n🎉 Cross-chain swap demonstration completed!');
        console.log('\n💡 To run with real transactions, ensure you have:');
        console.log('   - Sufficient TON testnet tokens');
        console.log('   - Sufficient Sepolia ETH');
        console.log('   - Valid RPC endpoints in .env');
        console.log('   - Then run: npm run test:crosschain');
        
    } catch (error) {
        console.error('❌ Demo failed:', error);
    }
}

async function demoEVMToTON() {
    // Generate swap parameters
    const { secret, hashlock } = await FusionHTLC.generateSecret();
    const swapAmount = ethers.parseEther('0.001'); // 0.001 ETH
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    console.log('\n🔐 Swap Parameters:');
    console.log('Amount:', ethers.formatEther(swapAmount), 'ETH → 0.05 TON');
    console.log('Secret:', secret.toString('hex'));
    console.log('Hashlock:', hashlock.toString('hex'));
    console.log('Timelock:', new Date(timelock * 1000).toLocaleString());
    
    console.log('\n📝 Step-by-Step Flow:');
    
    console.log('\n1️⃣ User creates HTLC on Sepolia');
    console.log('   Transaction: createHTLC(receiver, hashlock, timelock)');
    console.log('   Value: 0.001 ETH');
    console.log('   HTLC ID: 0x' + Buffer.from('mock-evm-htlc-id').toString('hex'));
    
    console.log('\n2️⃣ Resolver detects Sepolia HTLC creation');
    console.log('   Event: HTLCCreated(contractId, sender, receiver, amount, hashlock, timelock)');
    console.log('   Validates: Hashlock matches expected format');
    console.log('   Validates: Timelock gives enough time for cross-chain settlement');
    
    console.log('\n3️⃣ Resolver creates corresponding HTLC on TON');
    console.log('   Transaction: create_htlc(receiver, amount, hashlock, timelock - 30min)');
    console.log('   Value: 0.05 TON (equivalent value)');
    console.log('   HTLC ID: 1');
    
    console.log('\n4️⃣ User claims TON HTLC with secret');
    console.log('   Transaction: claim(htlc_id, secret)');
    console.log('   Secret revealed on-chain: ' + secret.toString('hex'));
    console.log('   User receives: 0.05 TON');
    
    console.log('\n5️⃣ Resolver detects secret and claims Sepolia HTLC');
    console.log('   Transaction: withdraw(contractId, secret)');
    console.log('   Resolver receives: 0.001 ETH');
    
    console.log('\n✅ EVM → TON swap completed successfully!');
}

async function demoTONToEVM() {
    // Generate swap parameters
    const { secret, hashlock } = await FusionHTLC.generateSecret();
    const swapAmount = toNano('0.05'); // 0.05 TON
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    console.log('\n🔐 Swap Parameters:');
    console.log('Amount:', Number(swapAmount) / 1e9, 'TON → 0.001 ETH');
    console.log('Secret:', secret.toString('hex'));
    console.log('Hashlock:', hashlock.toString('hex'));
    console.log('Timelock:', new Date(timelock * 1000).toLocaleString());
    
    console.log('\n📝 Step-by-Step Flow:');
    
    console.log('\n1️⃣ User creates HTLC on TON');
    console.log('   Transaction: create_htlc(receiver, amount, hashlock, timelock)');
    console.log('   Value: 0.05 TON');
    console.log('   HTLC ID: 2');
    
    console.log('\n2️⃣ Resolver detects TON HTLC creation');
    console.log('   Monitors TON blockchain for HTLC events');
    console.log('   Validates: Hashlock and timelock parameters');
    console.log('   Calculates: Equivalent ETH amount based on current rates');
    
    console.log('\n3️⃣ Resolver creates corresponding HTLC on Sepolia');
    console.log('   Transaction: createHTLC(receiver, hashlock, timelock - 30min)');
    console.log('   Value: 0.001 ETH (equivalent value)');
    console.log('   HTLC ID: 0x' + Buffer.from('mock-evm-htlc-id-2').toString('hex'));
    
    console.log('\n4️⃣ User claims Sepolia HTLC with secret');
    console.log('   Transaction: withdraw(contractId, secret)');
    console.log('   Secret revealed on-chain: ' + secret.toString('hex'));
    console.log('   User receives: 0.001 ETH');
    
    console.log('\n5️⃣ Resolver detects secret and claims TON HTLC');
    console.log('   Transaction: claim(htlc_id, secret)');
    console.log('   Resolver receives: 0.05 TON');
    
    console.log('\n✅ TON → EVM swap completed successfully!');
}

// Run demo
testCrossChainSwapMock().catch(console.error);