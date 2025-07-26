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

async function testWorkingCrossChain() {
    console.log('🔄 Testing Cross-Chain Swap - Working Version\n');
    
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
            evmRpcUrl: 'https://1rpc.io/sepolia',
            evmHTLCAddress: sharedDeployment.sepolia.contractAddress,
            evmPrivateKey: process.env.EVM_PRIVATE_KEY || '',
            evmHTLCABI: sharedDeployment.sepolia.abi,
        };
        
        // Initialize clients
        console.log('📱 Initializing clients...');
        const tonClient = new TonFusionClient(config.tonRpcUrl, config.tonHTLCAddress);
        await tonClient.init(config.tonMnemonic.split(' '));
        
        const evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
        const evmWallet = new ethers.Wallet(config.evmPrivateKey, evmProvider);
        const evmHTLC = new ethers.Contract(config.evmHTLCAddress, config.evmHTLCABI, evmWallet);
        
        console.log('TON Wallet:', tonClient.getWalletAddress());
        console.log('EVM Wallet:', evmWallet.address);
        
        // Generate swap parameters ONCE - DUAL HASH APPROACH
        const { secret, hashlock: tonHashlock } = await FusionHTLC.generateSecret();
        const evmHashlock = ethers.keccak256('0x' + secret.toString('hex'));
        const timelock = Math.floor(Date.now() / 1000) + 3600;
        
        console.log('\n🔐 Dual-Hash Swap Parameters:');
        console.log('Secret (same for both):', '0x' + secret.toString('hex'));
        console.log('TON Hashlock (SHA256)  :', '0x' + tonHashlock.toString('hex'));
        console.log('EVM Hashlock (KECCAK256):', evmHashlock);
        console.log('Secret length:', secret.length, 'bytes');
        
        // Verify both hashes
        const tonSHA256Check = ethers.sha256('0x' + secret.toString('hex'));
        const evmKECCAK256Check = ethers.keccak256('0x' + secret.toString('hex'));
        console.log('TON hash verification:', tonSHA256Check === ('0x' + tonHashlock.toString('hex')));
        console.log('EVM hash verification:', evmKECCAK256Check === evmHashlock);
        
        console.log('\n=== Step 1: Create HTLC on Sepolia ===');
        const swapAmount = ethers.parseEther('0.0001'); // Small test amount
        
        const createTx = await evmHTLC.createHTLC(
            evmWallet.address, // receiver
            evmHashlock, // Use KECCAK256 hashlock for EVM
            timelock,
            { value: swapAmount, gasLimit: 300000 }
        );
        
        console.log('Transaction sent:', createTx.hash);
        const receipt = await createTx.wait();
        
        const htlcCreatedEvent = receipt.logs.find((log: any) => 
            log.topics[0] === ethers.id('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256)')
        );
        const evmHTLCId = htlcCreatedEvent?.topics[1];
        console.log('✅ Sepolia HTLC created. ID:', evmHTLCId);
        
        // Verify HTLC data
        const htlcData = await evmHTLC.getContract(evmHTLCId);
        console.log('HTLC hashlock:', htlcData.hashlock);
        console.log('Expected (KECCAK256):', evmHashlock);
        
        console.log('\n=== Step 2: Create HTLC on TON ===');
        const tonAmount = toNano('0.05');
        const tonHTLCId = await tonClient.createHTLC({
            receiver: evmWallet.address,
            amount: tonAmount,
            hashlock: tonHashlock, // Use SHA256 hashlock for TON
            timelock: timelock - 1800,
        });
        console.log('✅ TON HTLC created. ID:', tonHTLCId);
        
        console.log('\n=== Step 3: Claim TON HTLC ===');
        await tonClient.claimHTLC(tonHTLCId, secret);
        console.log('✅ TON HTLC claimed with secret!');
        
        console.log('\n=== Step 4: Claim Sepolia HTLC ===');
        console.log('Using same secret to claim Sepolia HTLC...');
        console.log('Secret for withdraw:', '0x' + secret.toString('hex'));
        
        // Properly format the secret as bytes32
        const withdrawTx = await evmHTLC.withdraw(
            evmHTLCId,
            '0x' + secret.toString('hex'),
            { gasLimit: 200000 }
        );
        
        console.log('Withdraw transaction sent:', withdrawTx.hash);
        const withdrawReceipt = await withdrawTx.wait();
        
        if (withdrawReceipt?.status === 1) {
            console.log('✅ Sepolia HTLC claimed successfully!');
            
            // Verify final state
            const finalHTLC = await evmHTLC.getContract(evmHTLCId);
            console.log('\n📊 Final HTLC State:');
            console.log('- Withdrawn:', finalHTLC.withdrawn);
            console.log('- Preimage:', finalHTLC.preimage);
            
            console.log('\n🎉 Cross-chain atomic swap completed successfully!');
        } else {
            console.log('❌ Withdraw transaction failed');
        }
        
    } catch (error: any) {
        console.error('❌ Error:', error.reason || error.message);
        if (error.receipt) {
            console.log('Transaction hash:', error.receipt.hash);
            console.log('Check on Etherscan: https://sepolia.etherscan.io/tx/' + error.receipt.hash);
        }
    }
}

testWorkingCrossChain().catch(console.error);