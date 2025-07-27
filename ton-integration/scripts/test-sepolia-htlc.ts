import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { sha256 } from '@ton/crypto';

dotenv.config();

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function testSepoliaHTLC() {
    console.log('🧪 Testing Sepolia HTLC Contract\n');
    
    try {
        // Configuration
        const evmRpcUrl = 'https://eth-sepolia.public.blastapi.io';
        const evmPrivateKey = process.env.EVM_PRIVATE_KEY || '';
        const evmHTLCAddress = sharedDeployment.sepolia.contractAddress;
        const evmHTLCABI = sharedDeployment.sepolia.abi;
        
        // Initialize EVM client
        const evmProvider = new ethers.JsonRpcProvider(evmRpcUrl);
        const evmWallet = new ethers.Wallet(evmPrivateKey, evmProvider);
        const evmHTLC = new ethers.Contract(evmHTLCAddress, evmHTLCABI, evmWallet);
        
        console.log('Connected to Sepolia HTLC:', evmHTLCAddress);
        console.log('Wallet address:', evmWallet.address);
        
        // Generate a test secret
        const secret = Buffer.from('test_secret_12345678901234567890'); // 32 bytes
        const hashlockSHA256 = await sha256(secret);
        const hashlockKeccak = ethers.keccak256('0x' + secret.toString('hex'));
        
        console.log('\n🔐 Hash Test:');
        console.log('Secret:', secret.toString('hex'));
        console.log('SHA256:', hashlockSHA256.toString('hex'));
        console.log('Keccak256:', hashlockKeccak);
        
        // Create a small test HTLC
        console.log('\n📝 Creating test HTLC...');
        const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        const amount = ethers.parseEther('0.0001'); // Small amount
        
        try {
            // Try with SHA256 hash
            console.log('Testing with SHA256 hash...');
            const createTx = await evmHTLC.createHTLC(
                evmWallet.address, // receiver
                '0x' + hashlockSHA256.toString('hex'),
                timelock,
                { value: amount, gasLimit: 300000 }
            );
            
            console.log('Transaction sent:', createTx.hash);
            const receipt = await createTx.wait();
            console.log('Transaction confirmed');
            
            // Extract HTLC ID
            const htlcCreatedEvent = receipt.logs.find((log: any) => 
                log.topics[0] === ethers.id('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256)')
            );
            const htlcId = htlcCreatedEvent?.topics[1];
            console.log('HTLC ID:', htlcId);
            
            // Get HTLC details
            const htlcData = await evmHTLC.getContract(htlcId);
            console.log('\n📊 HTLC Created:');
            console.log('- Hashlock in contract:', htlcData.hashlock);
            console.log('- Our SHA256 hash:', '0x' + hashlockSHA256.toString('hex'));
            console.log('- Match?', htlcData.hashlock.toLowerCase() === ('0x' + hashlockSHA256.toString('hex')).toLowerCase());
            
            // Try to withdraw
            console.log('\n💸 Attempting withdraw...');
            const withdrawTx = await evmHTLC.withdraw(
                htlcId,
                '0x' + secret.toString('hex'),
                { gasLimit: 200000 }
            );
            
            console.log('Withdraw transaction sent:', withdrawTx.hash);
            await withdrawTx.wait();
            console.log('✅ Withdraw successful!');
            
        } catch (error: any) {
            console.error('❌ Error:', error.reason || error.message);
            
            // Try to decode error
            if (error.data && evmHTLC.interface) {
                try {
                    const decodedError = evmHTLC.interface.parseError(error.data);
                    console.log('Decoded error:', decodedError);
                } catch (e) {
                    // Ignore decode errors
                }
            }
        }
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testSepoliaHTLC().catch(console.error);