import { ethers } from 'ethers';
import { toNano } from '@ton/core';
import { TonFusionClient } from '../src/ton-fusion-client';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import { sha256 } from '@ton/crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function testDualHashCrossChain() {
    console.log('🔄 Testing Dual-Hash Cross-Chain Swap (SHA256 ↔ KECCAK256)\n');
    
    try {
        // Load deployments
        const tonDeploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
        const tonDeployment = JSON.parse(fs.readFileSync(tonDeploymentPath, 'utf-8'));
        const sharedDeployment = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
        );
        
        const config = {
            tonRpcUrl: 'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac6df03d0eb1e8c82b4',
            tonMnemonic: process.env.TON_MNEMONIC!.split(' '),
            tonHTLCAddress: tonDeployment.address,
            evmRpcUrl: 'https://ethereum-sepolia.publicnode.com',
            evmPrivateKey: process.env.EVM_PRIVATE_KEY!,
            evmHTLCAddress: sharedDeployment.sepolia.contractAddress,
            evmHTLCABI: sharedDeployment.sepolia.abi,
        };
        
        console.log('📱 Initializing clients...');
        console.log('TON HTLC:', config.tonHTLCAddress);
        console.log('Sepolia HTLC:', config.evmHTLCAddress);
        
        // Initialize clients
        const tonClient = new TonFusionClient(config.tonRpcUrl, config.tonHTLCAddress);
        await tonClient.init(config.tonMnemonic);
        const evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
        const evmWallet = new ethers.Wallet(config.evmPrivateKey, evmProvider);
        const evmHTLC = new ethers.Contract(config.evmHTLCAddress, config.evmHTLCABI, evmWallet);
        
        console.log('TON Wallet:', tonClient.getWalletAddress());
        console.log('EVM Wallet:', evmWallet.address);
        
        // Generate ONE secret for both chains
        const { secret, hashlock: tonHashlock } = await FusionHTLC.generateSecret();
        
        // Generate different hashlocks for each chain
        const evmHashlock = ethers.keccak256('0x' + secret.toString('hex'));
        
        console.log('\n🔐 Dual-Hash Parameters:');
        console.log('Secret (same for both):', '0x' + secret.toString('hex'));
        console.log('TON Hashlock (SHA256)  :', '0x' + tonHashlock.toString('hex'));
        console.log('EVM Hashlock (KECCAK256):', evmHashlock);
        
        const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        const amount = toNano('0.01');
        
        console.log('\n=== Step 1: Create EVM HTLC with KECCAK256 hashlock ===');
        
        const createEvmTx = await evmHTLC.createHTLC(
            evmWallet.address,    // _receiver
            evmHashlock,          // _hashlock (KECCAK256)
            timelock,             // _timelock
            { value: ethers.parseEther('0.01'), gasLimit: 300000 }
        );
        
        console.log('Transaction sent:', createEvmTx.hash);
        const evmReceipt = await createEvmTx.wait();
        
        // Extract HTLC ID from events
        const evmHTLCId = evmReceipt.logs[0].topics[1];
        console.log('✅ EVM HTLC created. ID:', evmHTLCId);
        
        console.log('\n=== Step 2: Create TON HTLC with SHA256 hashlock ===');
        
        const tonHTLCId = await tonClient.createHTLC({
            receiver: tonClient.getWalletAddress(),
            amount,
            hashlock: tonHashlock,  // SHA256 hashlock
            timelock
        });
        
        console.log('✅ TON HTLC created. ID:', tonHTLCId);
        
        console.log('\n=== Step 3: Claim TON HTLC with raw secret ===');
        
        await tonClient.claimHTLC(tonHTLCId, secret);
        console.log('✅ TON HTLC claimed! (SHA256 verification passed)');
        
        console.log('\n=== Step 4: Claim EVM HTLC with same raw secret ===');
        
        const withdrawTx = await evmHTLC.withdraw(
            evmHTLCId,
            '0x' + secret.toString('hex'),  // Same raw secret
            { gasLimit: 200000 }
        );
        
        console.log('Withdraw transaction sent:', withdrawTx.hash);
        const withdrawReceipt = await withdrawTx.wait();
        
        if (withdrawReceipt?.status === 1) {
            console.log('✅ EVM HTLC claimed! (KECCAK256 verification passed)');
            console.log('\n🎉 Dual-Hash Cross-Chain Swap SUCCESSFUL!');
            console.log('\n📊 Summary:');
            console.log('- Same secret used on both chains ✓');
            console.log('- TON used SHA256(secret) for verification ✓');
            console.log('- EVM used KECCAK256(secret) for verification ✓');
            console.log('- No contract redeployment needed ✓');
        } else {
            console.log('❌ EVM withdraw failed');
        }
        
    } catch (error: any) {
        console.error('❌ Error:', error.reason || error.message);
        if (error.receipt) {
            console.log('Transaction hash:', error.receipt.hash);
            console.log('Check on Etherscan: https://sepolia.etherscan.io/tx/' + error.receipt.hash);
        }
    }
}

testDualHashCrossChain().catch(console.error);