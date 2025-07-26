import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function testDirectTx() {
    console.log('🔍 Testing Direct Transaction\n');
    
    try {
        // Configuration
        const evmRpcUrl = 'https://eth-sepolia.g.alchemy.com/v2/EQg9SpbyMVLhZ7QmhA7bJ_U_z9QIIeTQ';
        const evmPrivateKey = process.env.EVM_PRIVATE_KEY || '';
        const evmHTLCAddress = sharedDeployment.sepolia.contractAddress;
        const evmHTLCABI = sharedDeployment.sepolia.abi;
        
        // Initialize provider and wallet
        const evmProvider = new ethers.JsonRpcProvider(evmRpcUrl);
        const evmWallet = new ethers.Wallet(evmPrivateKey, evmProvider);
        
        // Create interface
        const iface = new ethers.Interface(evmHTLCABI);
        
        // Use the HTLC we just created
        const htlcId = '0x8898a3b459832256ab3ed6c90a7c2c22e64617f9e62a6b0305c64f6098f6143f';
        const secret = '0x746573745f7365637265745f3132333435363738393031323334353637383930';
        
        console.log('HTLC ID:', htlcId);
        console.log('Secret:', secret);
        
        // Manually encode the withdraw function
        console.log('\n📝 Encoding withdraw function...');
        const encodedData = iface.encodeFunctionData('withdraw', [htlcId, secret]);
        console.log('Encoded data:', encodedData);
        console.log('Data length:', encodedData.length);
        
        // Send raw transaction
        console.log('\n📤 Sending raw transaction...');
        const tx = {
            to: evmHTLCAddress,
            from: evmWallet.address,
            data: encodedData,
            gasLimit: 200000,
            gasPrice: await evmProvider.getFeeData().then(fee => fee.gasPrice)
        };
        
        console.log('Transaction object:', tx);
        
        const sentTx = await evmWallet.sendTransaction(tx);
        console.log('Transaction sent:', sentTx.hash);
        console.log('Transaction data in sent tx:', sentTx.data);
        
        const receipt = await sentTx.wait();
        console.log('\nTransaction receipt:');
        console.log('- Status:', receipt?.status === 1 ? '✅ Success' : '❌ Failed');
        console.log('- Gas used:', receipt?.gasUsed.toString());
        
        if (receipt?.status === 1) {
            console.log('\n✅ Withdraw successful!');
        } else {
            console.log('\n❌ Transaction reverted');
            
            // Try to get the revert reason
            try {
                const tx = await evmProvider.getTransaction(sentTx.hash);
                console.log('Transaction from chain:', tx);
            } catch (e) {
                console.log('Could not fetch transaction');
            }
        }
        
    } catch (error: any) {
        console.error('Error:', error.reason || error.message);
        if (error.transaction) {
            console.log('Failed transaction:', error.transaction);
        }
    }
}

testDirectTx().catch(console.error);