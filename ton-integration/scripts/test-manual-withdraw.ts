import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function testManualWithdraw() {
    console.log('🔧 Testing Manual Withdraw Encoding\n');
    
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
        
        // Use the HTLC ID from the previous test
        const htlcId = '0xf0ae8dd173e471da52c3df56c36dd965f0323b521f6bb379b7deb3d53e0aa4ed';
        const secret = Buffer.from('746573745f7365637265745f3132333435363738393031323334353637383930', 'hex');
        
        console.log('HTLC ID:', htlcId);
        console.log('Secret:', secret.toString('hex'));
        
        // Get HTLC data first
        console.log('\n📊 Getting HTLC data...');
        const htlcData = await evmHTLC.getContract(htlcId);
        console.log('HTLC exists:', htlcData.sender !== '0x0000000000000000000000000000000000000000');
        console.log('Withdrawn:', htlcData.withdrawn);
        console.log('Sender:', htlcData.sender);
        console.log('Receiver:', htlcData.receiver);
        
        // Check if we're the receiver
        const isReceiver = htlcData.receiver.toLowerCase() === evmWallet.address.toLowerCase();
        console.log('Are we the receiver?', isReceiver);
        
        // Manually encode the withdraw function
        console.log('\n🔧 Encoding withdraw function...');
        const iface = new ethers.Interface(evmHTLCABI);
        const encodedData = iface.encodeFunctionData('withdraw', [
            htlcId,
            '0x' + secret.toString('hex')
        ]);
        console.log('Encoded data:', encodedData);
        console.log('Function selector:', encodedData.slice(0, 10));
        
        // Try to estimate gas with the encoded data
        console.log('\n⛽ Estimating gas...');
        try {
            const gasEstimate = await evmProvider.estimateGas({
                from: evmWallet.address,
                to: evmHTLCAddress,
                data: encodedData
            });
            console.log('Gas estimate:', gasEstimate.toString());
        } catch (error: any) {
            console.error('Gas estimation failed:', error.reason || error.message);
            
            // Try to get more info about the revert
            if (error.info && error.info.error) {
                console.log('Error details:', error.info.error);
            }
        }
        
        // Send the transaction manually
        console.log('\n📤 Sending transaction manually...');
        try {
            const tx = await evmWallet.sendTransaction({
                to: evmHTLCAddress,
                data: encodedData,
                gasLimit: 200000
            });
            
            console.log('Transaction sent:', tx.hash);
            const receipt = await tx.wait();
            console.log('Transaction status:', receipt?.status === 1 ? '✅ Success' : '❌ Failed');
            
            if (receipt?.status === 0) {
                console.log('Transaction reverted');
            }
        } catch (error: any) {
            console.error('Transaction failed:', error.reason || error.message);
        }
        
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testManualWithdraw().catch(console.error);