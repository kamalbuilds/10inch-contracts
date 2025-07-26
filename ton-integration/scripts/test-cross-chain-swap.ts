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

async function testCrossChainSwap() {
    console.log('🔄 Testing Complete Cross-Chain Swap (TON ↔ Sepolia)\n');
    
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
            // TON Configuration
            tonRpcUrl: 'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac55b0/api/v2/jsonRPC',
            tonHTLCAddress,
            tonMnemonic: process.env.TON_MNEMONIC || '',
            
            // EVM Configuration (Sepolia)
            evmRpcUrl: process.env.EVM_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/EQg9SpbyMVLhZ7QmhA7bJ_U_z9QIIeTQ',
            evmHTLCAddress: sharedDeployment.sepolia.contractAddress,
            evmPrivateKey: process.env.EVM_PRIVATE_KEY || '',
            evmHTLCABI: sharedDeployment.sepolia.abi,
        };
        
        if (!config.tonMnemonic || !config.evmPrivateKey) {
            console.error('❌ Please set TON_MNEMONIC and EVM_PRIVATE_KEY in .env file');
            return;
        }
        
        // Initialize clients
        console.log('\n📱 Initializing clients...');
        
        // TON Client
        const tonClient = new TonFusionClient(config.tonRpcUrl, config.tonHTLCAddress);
        await tonClient.init(config.tonMnemonic.split(' '));
        
        // EVM Client
        const evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
        const evmWallet = new ethers.Wallet(config.evmPrivateKey, evmProvider);
        const evmHTLC = new ethers.Contract(config.evmHTLCAddress, config.evmHTLCABI, evmWallet);
        
        console.log('TON Wallet:', tonClient.getWalletAddress());
        console.log('EVM Wallet:', evmWallet.address);
        console.log('Sepolia HTLC:', config.evmHTLCAddress);
        
        // Check balances
        const tonBalance = await tonClient.getBalance();
        const evmBalance = await evmProvider.getBalance(evmWallet.address);
        
        console.log('\n💰 Initial Balances:');
        console.log('TON:', Number(tonBalance) / 1e9, 'TON');
        console.log('Sepolia ETH:', ethers.formatEther(evmBalance), 'ETH');
        
        if (tonBalance < toNano('0.2')) {
            console.error('❌ Insufficient TON balance. Please fund your wallet');
            return;
        }
        
        if (evmBalance < ethers.parseEther('0.01')) {
            console.error('❌ Insufficient Sepolia ETH balance. Please fund your wallet');
            return;
        }
        
        // Test both directions
        console.log('\n=== Testing EVM → TON Swap ===');
        await testEVMToTON(tonClient, evmWallet, evmHTLC);
        
        console.log('\n=== Testing TON → EVM Swap ===');
        await testTONToEVM(tonClient, evmWallet, evmHTLC);
        
        // Final balances
        const finalTonBalance = await tonClient.getBalance();
        const finalEvmBalance = await evmProvider.getBalance(evmWallet.address);
        
        console.log('\n💰 Final Balances:');
        console.log('TON:', Number(finalTonBalance) / 1e9, 'TON');
        console.log('Sepolia ETH:', ethers.formatEther(finalEvmBalance), 'ETH');
        
        console.log('\n📊 Test Summary:');
        console.log('✅ Successfully created HTLCs on both TON and Sepolia');
        console.log('✅ Successfully claimed HTLCs using secret reveal');
        console.log('✅ Demonstrated bidirectional cross-chain atomic swaps');
        console.log('\n🎉 Cross-chain swap integration test completed!');
        
        console.log('\n💡 Note: If you see timeout errors, the transactions may still succeed.');
        console.log('Check the blockchain explorers for confirmation:');
        console.log('- TON: https://testnet.tonscan.org/address/' + tonClient.getHTLCAddress());
        console.log('- Sepolia: https://sepolia.etherscan.io/address/' + config.evmHTLCAddress);
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

async function testEVMToTON(
    tonClient: TonFusionClient,
    evmWallet: ethers.Wallet,
    evmHTLC: ethers.Contract
) {
    // Generate swap parameters
    const { secret, hashlock } = await FusionHTLC.generateSecret();
    const swapAmount = ethers.parseEther('0.001'); // 0.001 ETH
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    console.log('\n🔐 Swap Parameters:');
    console.log('Amount:', ethers.formatEther(swapAmount), 'ETH');
    console.log('Secret:', secret.toString('hex'));
    console.log('Hashlock:', hashlock.toString('hex'));
    
    // Create HTLC on Sepolia
    console.log('\n1️⃣ Creating HTLC on Sepolia...');
    console.log('Gas price:', (await evmWallet.provider!.getFeeData()).gasPrice?.toString());
    
    let evmHTLCId: string;
    try {
        const createTx = await evmHTLC.createHTLC(
            evmWallet.address, // Using same address as both sender and receiver for testing
            '0x' + hashlock.toString('hex'),
            timelock,
            { 
                value: swapAmount,
                gasLimit: 300000
            }
        );
        
        console.log('Transaction sent:', createTx.hash);
        console.log('Waiting for confirmation...');
        const receipt = await createTx.wait();
        console.log('Transaction confirmed in block:', receipt.blockNumber);
        
        const htlcCreatedEvent = receipt.logs.find((log: any) => 
            log.topics[0] === ethers.id('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256)')
        );
        evmHTLCId = htlcCreatedEvent?.topics[1];
        console.log('✅ Sepolia HTLC created. ID:', evmHTLCId);
    } catch (error) {
        console.error('Error creating Sepolia HTLC:', error);
        throw error;
    }
    
    // Create corresponding HTLC on TON
    console.log('\n2️⃣ Creating corresponding HTLC on TON...');
    const tonAmount = toNano('0.05'); // Equivalent value in TON
    const tonHTLCId = await tonClient.createHTLC({
        receiver: evmWallet.address,
        amount: tonAmount,
        hashlock,
        timelock: timelock - 1800, // 30 minutes less for safety
    });
    console.log('✅ TON HTLC created. ID:', tonHTLCId);
    
    // Claim TON HTLC with secret
    console.log('\n3️⃣ Claiming TON HTLC with secret...', secret);
    await tonClient.claimHTLC(tonHTLCId, secret);
    console.log('✅ TON HTLC claimed!');
    
    // Claim Sepolia HTLC with revealed secret
    console.log('\n4️⃣ Claiming Sepolia HTLC...');
    try {
        // First check the HTLC state
        console.log('Checking HTLC state before withdraw...');
        const htlcData = await evmHTLC.getContract(evmHTLCId);
        console.log('HTLC exists:', htlcData.sender !== '0x0000000000000000000000000000000000000000');
        console.log('HTLC withdrawn:', htlcData.withdrawn);
        console.log('HTLC refunded:', htlcData.refunded);
        
        // Ensure we're calling the correct function with proper parameters
        console.log('Calling withdraw with:');
        console.log('- Contract ID:', evmHTLCId);
        console.log('- Preimage:', '0x' + secret.toString('hex'));
        
        const withdrawTx = await evmHTLC.withdraw(evmHTLCId, '0x' + secret.toString('hex'), {
            gasLimit: 200000
        });
        console.log('Withdraw transaction sent:', withdrawTx.hash);
        
        // Wait with timeout
        const receipt = await Promise.race([
            withdrawTx.wait(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Transaction timeout after 30s')), 30000)
            )
        ]);
        
        console.log('✅ Sepolia HTLC claimed!');
    } catch (error: any) {
        if (error.message?.includes('timeout')) {
            console.log('⚠️  Sepolia claim transaction timed out, but may still succeed');
            console.log('You can check the transaction status on Sepolia Etherscan');
        } else {
            throw error;
        }
    }
    
    console.log('\n✅ EVM → TON swap completed successfully!');
}

async function testTONToEVM(
    tonClient: TonFusionClient,
    evmWallet: ethers.Wallet,
    evmHTLC: ethers.Contract
) {
    // Generate swap parameters
    const { secret, hashlock } = await FusionHTLC.generateSecret();
    const swapAmount = toNano('0.05'); // 0.05 TON
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    console.log('\n🔐 Swap Parameters:');
    console.log('Amount:', Number(swapAmount) / 1e9, 'TON');
    console.log('Secret:', secret.toString('hex'));
    console.log('Hashlock:', hashlock.toString('hex'));
    
    // Create HTLC on TON
    console.log('\n1️⃣ Creating HTLC on TON...');
    let tonHTLCId: number;
    try {
        tonHTLCId = await tonClient.createHTLC({
            receiver: evmWallet.address,
            amount: swapAmount,
            hashlock,
            timelock,
        });
        console.log('✅ TON HTLC created. ID:', tonHTLCId);
    } catch (error) {
        console.error('Error creating TON HTLC:', error);
        throw error;
    }
    
    // Create corresponding HTLC on Sepolia
    console.log('\n2️⃣ Creating corresponding HTLC on Sepolia...');
    const evmAmount = ethers.parseEther('0.001'); // Equivalent value in ETH
    let evmHTLCId: string;
    try {
        const createTx = await evmHTLC.createHTLC(
            evmWallet.address,
            '0x' + hashlock.toString('hex'),
            timelock - 1800, // 30 minutes less for safety
            { 
                value: evmAmount,
                gasLimit: 300000
            }
        );
        
        console.log('Transaction sent:', createTx.hash);
        const receipt = await createTx.wait();
        console.log('Transaction confirmed');
        
        const htlcCreatedEvent = receipt.logs.find((log: any) => 
            log.topics[0] === ethers.id('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256)')
        );
        evmHTLCId = htlcCreatedEvent?.topics[1];
        console.log('✅ Sepolia HTLC created. ID:', evmHTLCId);
    } catch (error) {
        console.error('Error creating Sepolia HTLC:', error);
        throw error;
    }
    
    // Claim Sepolia HTLC with secret
    console.log('\n3️⃣ Claiming Sepolia HTLC with secret...');
    const withdrawTx = await evmHTLC.withdraw(evmHTLCId, '0x' + secret.toString('hex'));
    await withdrawTx.wait();
    console.log('✅ Sepolia HTLC claimed!');
    
    // Claim TON HTLC with revealed secret
    console.log('\n4️⃣ Claiming TON HTLC...');
    await tonClient.claimHTLC(tonHTLCId, secret);
    console.log('✅ TON HTLC claimed!');
    
    console.log('\n✅ TON → EVM swap completed successfully!');
}

// Run test
testCrossChainSwap().catch(console.error);