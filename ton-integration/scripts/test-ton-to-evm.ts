import { ethers } from 'ethers';
import { toNano } from '@ton/core';
import { TonFusionClient } from '../src/ton-fusion-client';
import { generateSecret, calculateTimelock } from '../src/utils';
import * as fs from 'fs';
import * as path from 'path';

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function testTONToEVMSwap() {
    console.log('🔄 Testing TON to EVM Cross-Chain Swap\n');
    
    try {
        // Load deployment info
        const deploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
        let tonHTLCAddress: string;
        
        if (fs.existsSync(deploymentPath)) {
            const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));
            tonHTLCAddress = deployment.address;
        } else {
            console.error('❌ No deployment found. Please run deploy-testnet.ts first');
            return;
        }
        
        // Configuration
        const config = {
            // TON Configuration
            tonRpcUrl: 'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac55b0/api/v2/jsonRPC',
            tonHTLCAddress,
            tonMnemonic: process.env.TON_MNEMONIC || 'your mnemonic here',
            
            // EVM Configuration (Sepolia)
            evmRpcUrl: process.env.EVM_RPC_URL || 'https://1rpc.io/sepolia',
            evmHTLCAddress: sharedDeployment.sepolia.contractAddress, // Using shared deployment
            evmPrivateKey: process.env.EVM_PRIVATE_KEY || '',
            evmHTLCABI: sharedDeployment.sepolia.abi,
        };
        
        // Initialize clients
        console.log('📱 Initializing clients...');
        
        // TON Client
        const tonClient = new TonFusionClient(config.tonRpcUrl, config.tonHTLCAddress);
        await tonClient.init(config.tonMnemonic.split(' '));
        
        // EVM Client
        const evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
        const evmWallet = new ethers.Wallet(config.evmPrivateKey, evmProvider);
        const evmHTLC = new ethers.Contract(config.evmHTLCAddress, config.evmHTLCABI, evmWallet);
        
        console.log('TON Wallet:', tonClient.getWalletAddress());
        console.log('EVM Wallet:', evmWallet.address);
        
        // Check balances
        const tonBalance = await tonClient.getBalance();
        const evmBalance = await evmProvider.getBalance(evmWallet.address);
        
        console.log('\n💰 Balances:');
        console.log('TON:', Number(tonBalance) / 1e9, 'TON');
        console.log('EVM:', ethers.formatEther(evmBalance), 'ETH');
        
        // Generate swap parameters
        const { secret, hashlock } = await generateSecret();
        const swapAmount = toNano('0.1'); // 0.1 TON
        const timelock = calculateTimelock(3600); // 1 hour
        
        console.log('\n🔐 Swap Parameters:');
        console.log('Amount:', Number(swapAmount) / 1e9, 'TON');
        console.log('Hashlock:', hashlock.toString('hex'));
        console.log('Timelock:', new Date(timelock * 1000).toLocaleString());
        
        // Step 1: Create HTLC on TON (source chain)
        console.log('\n1️⃣ Creating HTLC on TON...');
        const tonHTLCId = await tonClient.createHTLC({
            receiver: evmWallet.address, // Simplified address conversion
            amount: swapAmount,
            hashlock,
            timelock,
        });
        
        console.log('✅ TON HTLC created. ID:', tonHTLCId);
        
        // Verify HTLC creation
        const tonHTLC = await tonClient.getHTLC(tonHTLCId);
        console.log('HTLC State:', {
            amount: tonHTLC?.amount.toString(),
            receiver: tonHTLC?.receiver.toString(),
            timelock: tonHTLC?.timelock,
        });
        
        // Step 2: Wait for resolver to create corresponding HTLC on EVM
        console.log('\n2️⃣ Waiting for resolver to create EVM HTLC...');
        console.log('⏳ In a real scenario, the resolver would detect the TON HTLC and create a matching one on EVM');
        
        // For demo purposes, we'll create it manually
        console.log('Using shared HTLC at:', config.evmHTLCAddress);
        const evmAmount = ethers.parseEther('0.001'); // Equivalent value in ETH
        const createTx = await evmHTLC.createHTLC(
            tonClient.getWalletAddress(), // Receiver's TON address
            '0x' + hashlock.toString('hex'),
            timelock - 1800, // 30 minutes less for safety
            { value: evmAmount }
        );
        
        const receipt = await createTx.wait();
        // Extract HTLC ID from events
        const htlcCreatedEvent = receipt.logs.find((log: any) => 
            log.topics[0] === ethers.id('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256)')
        );
        const evmHTLCId = htlcCreatedEvent?.topics[1] || receipt.logs[0].topics[1];
        console.log('✅ EVM HTLC created. ID:', evmHTLCId);
        
        // Step 3: Reveal secret and claim on EVM
        console.log('\n3️⃣ Claiming EVM HTLC with secret...');
        const claimTx = await evmHTLC.withdraw(evmHTLCId, '0x' + secret.toString('hex'));
        await claimTx.wait();
        console.log('✅ EVM HTLC claimed successfully!');
        
        // Step 4: Resolver claims on TON using the revealed secret
        console.log('\n4️⃣ Resolver claiming TON HTLC...');
        await tonClient.claimHTLC(tonHTLCId, secret);
        console.log('✅ TON HTLC claimed successfully!');
        
        // Verify final state
        console.log('\n📊 Final State:');
        const finalTonHTLC = await tonClient.getHTLC(tonHTLCId);
        const finalEvmHTLC = await evmHTLC.getContract(evmHTLCId);
        
        console.log('TON HTLC:', {
            claimed: finalTonHTLC?.claimed,
            secret: finalTonHTLC?.secret?.toString('hex'),
        });
        
        console.log('EVM HTLC:', {
            withdrawn: finalEvmHTLC.withdrawn,
            preimage: finalEvmHTLC.preimage,
        });
        
        console.log('\n🎉 Cross-chain swap (TON → EVM) completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run test
testTONToEVMSwap().catch(console.error);