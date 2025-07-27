import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function debugWithdraw() {
    console.log('🔍 Debugging Sepolia HTLC Withdraw Issue\n');
    
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
        
        // Test data from the failed transaction
        const htlcId = '0x6331c3650c0a6fa8ec295585a0d915deb4421d3ec865be36dab12648aae4c07f';
        const secret = Buffer.from('2c43f7b0f82efcd37c51944ccd80c1c711a2782e6ba9be4f7e379f4ee85254bf', 'hex');
        const expectedHashlock = '0ddf3f48ee8b94b1d167e3b745d3ca5d1d4526d07a639b16d8013f162e6ee978';
        
        console.log('📊 HTLC Details:');
        console.log('HTLC ID:', htlcId);
        console.log('Secret:', secret.toString('hex'));
        console.log('Expected Hashlock:', expectedHashlock);
        
        // Calculate the actual hashlock from the secret
        const actualHashlock = ethers.keccak256('0x' + secret.toString('hex'));
        console.log('Actual Hashlock (keccak256):', actualHashlock);
        
        // Also try SHA256
        const sha256Hash = ethers.sha256('0x' + secret.toString('hex'));
        console.log('SHA256 Hash:', sha256Hash);
        
        // Get HTLC state
        console.log('\n📋 Checking HTLC State...');
        try {
            const htlcData = await evmHTLC.getContract(htlcId);
            console.log('HTLC Data:');
            console.log('- Sender:', htlcData.sender);
            console.log('- Receiver:', htlcData.receiver);
            console.log('- Amount:', htlcData.amount.toString());
            console.log('- Hashlock:', htlcData.hashlock);
            console.log('- Timelock:', htlcData.timelock.toString());
            console.log('- Withdrawn:', htlcData.withdrawn);
            console.log('- Refunded:', htlcData.refunded);
            
            // Check if hashlocks match
            console.log('\n🔐 Hashlock Comparison:');
            console.log('Contract Hashlock:', htlcData.hashlock);
            console.log('Expected Hashlock:', '0x' + expectedHashlock);
            console.log('Match?', htlcData.hashlock.toLowerCase() === ('0x' + expectedHashlock).toLowerCase());
            
            // Try the withdraw with proper encoding
            console.log('\n📝 Encoding withdraw call...');
            const withdrawData = evmHTLC.interface.encodeFunctionData('withdraw', [
                htlcId,
                '0x' + secret.toString('hex')
            ]);
            console.log('Encoded data:', withdrawData);
            
            // Estimate gas
            console.log('\n⛽ Estimating gas...');
            try {
                const gasEstimate = await evmWallet.estimateGas({
                    to: evmHTLCAddress,
                    data: withdrawData
                });
                console.log('Gas estimate:', gasEstimate.toString());
            } catch (error: any) {
                console.error('Gas estimation failed:', error.reason || error.message);
                
                // Try to decode the error
                if (error.data) {
                    try {
                        const decodedError = evmHTLC.interface.parseError(error.data);
                        console.log('Decoded error:', decodedError);
                    } catch (e) {
                        console.log('Could not decode error data');
                    }
                }
            }
            
        } catch (error: any) {
            console.error('Error getting HTLC data:', error.message);
        }
        
    } catch (error) {
        console.error('Debug failed:', error);
    }
}

debugWithdraw().catch(console.error);