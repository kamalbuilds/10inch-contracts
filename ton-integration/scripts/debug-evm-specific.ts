import { ethers } from 'ethers';
import { sha256 } from '@ton/crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function debugEVMSpecific() {
    console.log('🔍 Debugging EVM Contract Specific Issues\n');
    
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
        
        // Test 1: Create HTLC with known secret, hash in different ways
        console.log('\n=== Test 1: Different Hash Creation Methods ===');
        
        // Method 1: TON-style secret generation
        const tonSecret = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
            tonSecret[i] = Math.floor(Math.random() * 256);
        }
        const tonHash = await sha256(tonSecret);
        
        console.log('TON Secret:', tonSecret.toString('hex'));
        console.log('TON Hash  :', tonHash.toString('hex'));
        
        // Method 2: Ethers-style hash creation
        const ethersHash = ethers.sha256(tonSecret);
        console.log('Ethers Hash:', ethersHash);
        console.log('Hash Match :', tonHash.toString('hex') === ethersHash.slice(2));
        
        // Create HTLC with TON-generated hash
        console.log('\n=== Creating HTLC with TON-style secret ===');
        const timelock = Math.floor(Date.now() / 1000) + 3600;
        const amount = ethers.parseEther('0.0001');
        
        const createTx = await evmHTLC.createHTLC(
            evmWallet.address, // receiver = sender for testing
            '0x' + tonHash.toString('hex'), // Use TON-generated hash
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
        
        // Extract contract ID
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
            throw new Error('Could not extract contract ID');
        }
        
        // Test withdrawal with different secret formats
        console.log('\n=== Testing Different Secret Formats ===');
        
        const secretFormats = [
            {
                name: 'Raw Buffer as hex',
                value: '0x' + tonSecret.toString('hex')
            },
            {
                name: 'Buffer as bytes32 (ethers)',
                value: ethers.hexlify(tonSecret)
            },
            {
                name: 'Direct hex string',
                value: tonSecret.toString('hex').padStart(64, '0')
            }
        ];
        
        for (const format of secretFormats) {
            console.log(`\nTesting: ${format.name}`);
            console.log(`Value: ${format.value}`);
            
            try {
                // Simulate first
                const simResult = await evmHTLC.withdraw.staticCall(contractId, format.value);
                console.log('✅ Simulation successful');
                
                // If simulation works, try the actual call
                const withdrawTx = await evmHTLC.withdraw(contractId, format.value, {
                    gasLimit: 200000,
                    gasPrice: ethers.parseUnits('20', 'gwei')
                });
                
                console.log('Withdraw TX:', withdrawTx.hash);
                const withdrawReceipt = await withdrawTx.wait();
                
                if (withdrawReceipt.status === 1) {
                    console.log('✅ SUCCESS! This format works!');
                    break;
                } else {
                    console.log('❌ Transaction mined but reverted');
                }
                
            } catch (error: any) {
                console.log('❌ Failed:', error.message.split('\n')[0]);
            }
        }
        
        // Test 2: Check if the issue is with the secret vs preimage terminology
        console.log('\n=== Test 2: Direct Contract State Inspection ===');
        
        try {
            const htlcData = await evmHTLC.getContract(contractId);
            console.log('Contract State:');
            console.log('  Hashlock    :', htlcData[3]);
            console.log('  Expected    :', '0x' + tonHash.toString('hex'));
            console.log('  Match       :', htlcData[3] === ('0x' + tonHash.toString('hex')));
            console.log('  Withdrawn   :', htlcData[5]);
            console.log('  Refunded    :', htlcData[6]);
            
            // Try to verify the hash manually
            console.log('\n=== Manual Hash Verification ===');
            const manualHash = ethers.sha256('0x' + tonSecret.toString('hex'));
            console.log('Manual hash from secret:', manualHash);
            console.log('Stored hashlock        :', htlcData[3]);
            console.log('Manual verification    :', manualHash === htlcData[3]);
            
        } catch (error: any) {
            console.log('❌ Could not get contract state:', error.message);
        }
        
    } catch (error: any) {
        console.error('❌ Debug failed:', error.message);
    }
}

debugEVMSpecific().catch(console.error);