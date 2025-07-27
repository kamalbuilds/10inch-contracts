import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function fixWithdraw() {
    console.log('🔧 Fixing Withdraw Issue\n');
    
    try {
        // Configuration
        const evmRpcUrl = 'https://eth-sepolia.public.blastapi.io';
        const evmPrivateKey = process.env.EVM_PRIVATE_KEY || '';
        const evmHTLCAddress = sharedDeployment.sepolia.contractAddress;
        const evmHTLCABI = sharedDeployment.sepolia.abi;
        
        // Initialize EVM client
        const evmProvider = new ethers.JsonRpcProvider(evmRpcUrl);
        const evmWallet = new ethers.Wallet(evmPrivateKey, evmProvider);
        
        // Look at the ABI to understand the withdraw function
        console.log('📋 Checking withdraw function in ABI...');
        const withdrawABI = evmHTLCABI.find((item: any) => item.name === 'withdraw');
        console.log('Withdraw function:', JSON.stringify(withdrawABI, null, 2));
        
        // The function expects (bytes32 contractId, bytes32 preimage)
        // Both parameters are bytes32 (32 bytes, fixed size)
        
        // Create a proper 32-byte secret
        const secret = Buffer.from('test_secret_12345678901234567890', 'utf8');
        console.log('\n🔐 Secret details:');
        console.log('Secret (utf8):', secret.toString());
        console.log('Secret (hex):', secret.toString('hex'));
        console.log('Secret length:', secret.length, 'bytes');
        
        // Calculate SHA256 hash
        const hashlock = ethers.sha256('0x' + secret.toString('hex'));
        console.log('SHA256 Hashlock:', hashlock);
        
        // Now let's create a new HTLC with this properly formatted secret
        console.log('\n📝 Creating new HTLC with proper secret format...');
        const evmHTLC = new ethers.Contract(evmHTLCAddress, evmHTLCABI, evmWallet);
        
        const amount = ethers.parseEther('0.0001');
        const timelock = Math.floor(Date.now() / 1000) + 3600;
        
        const createTx = await evmHTLC.createHTLC(
            evmWallet.address,
            hashlock, // Already 0x-prefixed bytes32
            timelock,
            { value: amount, gasLimit: 300000 }
        );
        
        console.log('Transaction sent:', createTx.hash);
        const createReceipt = await createTx.wait();
        console.log('HTLC created');
        
        // Extract HTLC ID
        const htlcCreatedEvent = createReceipt.logs.find((log: any) => 
            log.topics[0] === ethers.id('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256)')
        );
        const htlcId = htlcCreatedEvent?.topics[1];
        console.log('HTLC ID:', htlcId);
        
        // Now withdraw with the proper preimage format
        console.log('\n💸 Withdrawing with proper preimage format...');
        
        // The preimage needs to be exactly 32 bytes, padded with zeros if necessary
        const preimage = '0x' + secret.toString('hex');
        console.log('Preimage for withdraw:', preimage);
        
        const withdrawTx = await evmHTLC.withdraw(
            htlcId,
            preimage,
            { gasLimit: 200000 }
        );
        
        console.log('Withdraw transaction sent:', withdrawTx.hash);
        const withdrawReceipt = await withdrawTx.wait();
        
        if (withdrawReceipt?.status === 1) {
            console.log('✅ Withdraw successful!');
            
            // Check the HTLC state
            const htlcData = await evmHTLC.getContract(htlcId);
            console.log('\n📊 Final HTLC state:');
            console.log('- Withdrawn:', htlcData.withdrawn);
            console.log('- Preimage stored:', htlcData.preimage);
        } else {
            console.log('❌ Withdraw failed');
        }
        
    } catch (error: any) {
        console.error('Error:', error.reason || error.message);
    }
}

fixWithdraw().catch(console.error);