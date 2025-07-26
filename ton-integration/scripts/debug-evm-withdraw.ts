import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function debugEVMWithdraw() {
    console.log('🔍 Debugging EVM HTLC Withdraw Issue\n');
    
    try {
        // Load shared HTLC deployment
        const sharedDeployment = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
        );
        
        const config = {
            evmRpcUrl: 'https://ethereum-sepolia.publicnode.com',
            evmPrivateKey: process.env.EVM_PRIVATE_KEY!,
            evmHTLCAddress: sharedDeployment.sepolia.contractAddress,
            evmHTLCABI: sharedDeployment.sepolia.abi,
        };
        
        // Initialize EVM client
        const evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
        const evmWallet = new ethers.Wallet(config.evmPrivateKey, evmProvider);
        const evmHTLC = new ethers.Contract(config.evmHTLCAddress, config.evmHTLCABI, evmWallet);
        
        console.log('📱 EVM Wallet:', evmWallet.address);
        console.log('📄 HTLC Contract:', config.evmHTLCAddress);
        
        // Create a test HTLC first
        console.log('\n=== Step 1: Create Test HTLC ===');
        const testSecret = Buffer.alloc(32);
        testSecret.fill('A'); // Fill with 'A' to create exactly 32 bytes
        const secretHash = ethers.sha256(testSecret);
        const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        const amount = ethers.parseEther('0.0001');
        
        console.log('Secret:', testSecret.toString('hex'));
        console.log('Secret Hash:', secretHash);
        console.log('Timelock:', timelock);
        
        const createTx = await evmHTLC.createHTLC(
            evmWallet.address, // receiver
            secretHash,
            timelock,
            { 
                value: amount,
                gasLimit: 300000,
                gasPrice: ethers.parseUnits('20', 'gwei')
            }
        );
        
        console.log('Create TX:', createTx.hash);
        const createReceipt = await createTx.wait();
        console.log('✅ HTLC Created');
        
        // Extract contract ID from events
        let contractId = null;
        for (const log of createReceipt.logs) {
            try {
                const parsedLog = evmHTLC.interface.parseLog(log);
                if (parsedLog?.name === 'HTLCCreated') {
                    contractId = parsedLog.args.contractId;
                    console.log('Contract ID:', contractId);
                    break;
                }
            } catch (e) {
                // Skip unparseable logs
            }
        }
        
        if (!contractId) {
            throw new Error('Could not extract contract ID from create transaction');
        }
        
        console.log('\n=== Step 2: Check HTLC State ===');
        
        // Check if HTLC exists and get its state
        try {
            const htlcData = await evmHTLC.getContract(contractId);
            console.log('HTLC exists: true');
            console.log('HTLC Data:');
            console.log('  Sender:', htlcData[0]);
            console.log('  Receiver:', htlcData[1]);
            console.log('  Amount:', ethers.formatEther(htlcData[2]), 'ETH');
            console.log('  Hashlock:', htlcData[3]);
            console.log('  Timelock:', htlcData[4]);
            console.log('  Withdrawn:', htlcData[5]);
            console.log('  Refunded:', htlcData[6]);
            console.log('  Preimage:', htlcData[7]);
            
            // Verify hash matches
            console.log('\n=== Hash Verification ===');
            console.log('Expected hash:', secretHash);
            console.log('Contract hash:', htlcData[3]);
            console.log('Hashes match:', secretHash === htlcData[3]);
        } catch (error: any) {
            console.log('❌ Could not get HTLC data:', error.message);
        }
        
        console.log('\n=== Step 3: Attempt Withdraw ===');
        
        const preimage = '0x' + testSecret.toString('hex');
        console.log('Using preimage:', preimage);
        
        // First simulate the withdraw
        try {
            console.log('Simulating withdraw...');
            const simulateResult = await evmHTLC.withdraw.staticCall(contractId, preimage);
            console.log('✅ Simulation successful:', simulateResult);
        } catch (error: any) {
            console.log('❌ Simulation failed:', error.message);
            
            // Try to decode the error
            if (error.data) {
                try {
                    const decodedError = evmHTLC.interface.parseError(error.data);
                    console.log('Decoded error:', decodedError);
                } catch (decodeError) {
                    console.log('Could not decode error data:', error.data);
                }
            }
        }
        
        // Now try the actual withdraw
        try {
            console.log('Attempting actual withdraw...');
            const withdrawTx = await evmHTLC.withdraw(contractId, preimage, {
                gasLimit: 200000,
                gasPrice: ethers.parseUnits('20', 'gwei')
            });
            
            console.log('Withdraw TX:', withdrawTx.hash);
            const withdrawReceipt = await withdrawTx.wait();
            
            if (withdrawReceipt.status === 1) {
                console.log('✅ Withdraw successful!');
                console.log('Gas used:', withdrawReceipt.gasUsed.toString());
            } else {
                console.log('❌ Withdraw failed (status 0)');
            }
        } catch (error: any) {
            console.log('❌ Withdraw transaction failed:', error.message);
            
            if (error.receipt) {
                console.log('Transaction was mined but reverted');
                console.log('Gas used:', error.receipt.gasUsed.toString());
                console.log('Status:', error.receipt.status);
            }
        }
        
    } catch (error: any) {
        console.error('❌ Debug failed:', error.message);
    }
}

debugEVMWithdraw().catch(console.error);