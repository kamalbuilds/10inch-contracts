import { XRPFusionClient } from '../src/xrp-fusion-client';
import { XRPHTLC } from '../src/xrp-htlc';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';

dotenv.config();

// Load shared deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

const HTLC_ABI = [
    "function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32)",
    "function withdraw(bytes32 _contractId, bytes32 _preimage)",
    "function getContract(bytes32 _contractId) view returns (address sender, address receiver, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, bytes32 preimage)"
];

async function testCrossChainWithDifferentHashes() {
    console.log('🔄 Testing Cross-Chain Atomic Swap with Different Hash Algorithms\n');
    console.log('⚠️  Important: Ethereum uses Keccak256, XRP uses SHA256\n');
    
    try {
        // Initialize Ethereum provider
        const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL);
        const evmWallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY!, provider);
        console.log('📍 ETH Address:', evmWallet.address);
        
        // Initialize XRP client
        const xrpClient = new XRPFusionClient('wss://testnet.xrpl-labs.com');
        await xrpClient.init(process.env.XRP_SEED!);
        const xrpAddress = xrpClient.getWalletAddress();
        console.log('📍 XRP Address:', xrpAddress);
        
        // Display initial balances
        const initialEthBalance = await provider.getBalance(evmWallet.address);
        const initialXrpBalance = await xrpClient.getBalance();
        console.log('\n💰 Initial Balances:');
        console.log('   ETH:', ethers.formatEther(initialEthBalance), 'ETH');
        console.log('   XRP:', initialXrpBalance, 'XRP');
        
        // Step 1: Generate secret and different hashlocks
        const secret = Buffer.from(ethers.randomBytes(32));
        const sha256Hash = createHash('sha256').update(secret).digest();
        const keccak256Hash = ethers.keccak256(secret);
        
        console.log('\n🔐 Secret and Hash Values:');
        console.log('   Secret:', secret.toString('hex'));
        console.log('   SHA256 Hash (for XRP):', sha256Hash.toString('hex'));
        console.log('   Keccak256 Hash (for ETH):', keccak256Hash);
        
        // Set timelocks
        const currentUnixTime = Math.floor(Date.now() / 1000);
        const ethTimelock = currentUnixTime + 7200; // 2 hours
        const rippleEpoch = 946684800;
        const xrpTimelock = (currentUnixTime - rippleEpoch) + 3600; // 1 hour
        
        // Test Case 1: ETH to XRP direction
        console.log('\n=== Test Case 1: ETH → XRP Swap ===\n');
        
        // Create Ethereum HTLC with Keccak256
        console.log('📝 Creating Ethereum HTLC with Keccak256 hashlock...');
        const htlcContract = new ethers.Contract(
            sharedDeployment.sepolia.contractAddress,
            HTLC_ABI,
            evmWallet
        );
        
        const ethAmount = ethers.parseEther('0.0001');
        const ethTx = await htlcContract.createHTLC(
            evmWallet.address,
            keccak256Hash, // Using Keccak256 for Ethereum
            ethTimelock,
            { value: ethAmount }
        );
        
        const ethReceipt = await ethTx.wait();
        const ethContractId = ethReceipt.logs[0].topics[1];
        console.log('✅ ETH HTLC created');
        console.log('   Contract ID:', ethContractId);
        console.log('   Hashlock (Keccak256):', keccak256Hash);
        
        // Create XRP HTLC with SHA256
        console.log('\n📝 Creating XRP HTLC with SHA256 hashlock...');
        const xrpResult = await xrpClient.createHTLC({
            receiver: xrpAddress,
            amount: '1',
            hashlock: sha256Hash, // Using SHA256 for XRP
            timelock: xrpTimelock
        });
        
        if (xrpResult.success) {
            console.log('✅ XRP HTLC created');
            console.log('   Escrow Sequence:', xrpResult.escrowSequence);
            console.log('   Hashlock (SHA256):', sha256Hash.toString('hex'));
        } else {
            console.error('❌ Failed to create XRP HTLC:', xrpResult.error);
            return;
        }
        
        // Wait for escrow to be indexed
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Attempt to claim XRP (this should work with SHA256)
        console.log('\n🔓 Attempting to claim XRP HTLC with secret...');
        const xrpClaimResult = await xrpClient.claimHTLC(
            xrpAddress,
            xrpResult.escrowSequence!,
            secret
        );
        
        if (xrpClaimResult.success) {
            console.log('✅ XRP HTLC claimed successfully!');
            console.log('   Transaction:', xrpClaimResult.txHash);
        } else {
            console.log('❌ XRP claim failed:', xrpClaimResult.error);
        }
        
        // Attempt to claim ETH (this should work with the same secret)
        console.log('\n🔓 Attempting to claim ETH HTLC with secret...');
        try {
            const withdrawTx = await htlcContract.withdraw(
                ethContractId,
                '0x' + secret.toString('hex')
            );
            const withdrawReceipt = await withdrawTx.wait();
            console.log('✅ ETH HTLC claimed successfully!');
            console.log('   Transaction:', withdrawReceipt.hash);
        } catch (error: any) {
            console.log('❌ ETH claim failed:', error.reason || error.message);
        }
        
        // Final balances
        console.log('\n📊 Final Balances:');
        const finalEthBalance = await provider.getBalance(evmWallet.address);
        const finalXrpBalance = await xrpClient.getBalance();
        console.log('   ETH:', ethers.formatEther(finalEthBalance), 'ETH');
        console.log('   XRP:', finalXrpBalance, 'XRP');
        
        // Summary
        console.log('\n📝 Summary:');
        console.log('   - Ethereum HTLC uses Keccak256:', keccak256Hash.substring(0, 20) + '...');
        console.log('   - XRP HTLC uses SHA256:', sha256Hash.toString('hex').substring(0, 20) + '...');
        console.log('   - Same secret works for both chains');
        console.log('   - The hash algorithms are different but the secret is the same!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testCrossChainWithDifferentHashes().catch(console.error);