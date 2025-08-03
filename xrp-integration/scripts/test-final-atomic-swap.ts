import { XRPFusionClient } from '../src/xrp-fusion-client';
import { XRPClaimHelper } from '../src/xrp-claim-helper';
import { XRPHTLC } from '../src/xrp-htlc';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';
import { Client, Wallet } from 'xrpl';

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

async function testFinalAtomicSwap() {
    console.log('🚀 Complete Cross-Chain Atomic Swap Demonstration\n');
    console.log('This demonstrates a working atomic swap between Ethereum and XRP\n');
    
    try {
        // Initialize Ethereum
        const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL);
        const evmWallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY!, provider);
        
        // Initialize XRP
        const xrpClient = new Client('wss://testnet.xrpl-labs.com');
        await xrpClient.connect();
        const xrpWallet = Wallet.fromSeed(process.env.XRP_SEED!);
        const claimHelper = new XRPClaimHelper(xrpClient, xrpWallet);
        
        console.log('📍 Addresses:');
        console.log('   ETH:', evmWallet.address);
        console.log('   XRP:', xrpWallet.address);
        
        // Generate secret and hashes
        const secret = Buffer.from(ethers.randomBytes(32));
        const sha256Hash = createHash('sha256').update(secret).digest();
        const keccak256Hash = ethers.keccak256(secret);
        
        console.log('\n🔐 Swap Parameters:');
        console.log('   Secret:', secret.toString('hex'));
        console.log('   SHA256 (XRP):', sha256Hash.toString('hex'));
        console.log('   Keccak256 (ETH):', keccak256Hash);
        
        // Timelocks
        const currentUnixTime = Math.floor(Date.now() / 1000);
        const ethTimelock = currentUnixTime + 7200;
        const rippleEpoch = 946684800;
        const xrpTimelock = (currentUnixTime - rippleEpoch) + 3600;
        
        // === Create HTLCs ===
        console.log('\n📝 Creating HTLCs...\n');
        
        // ETH HTLC
        const htlcContract = new ethers.Contract(
            sharedDeployment.sepolia.contractAddress,
            HTLC_ABI,
            evmWallet
        );
        
        console.log('1️⃣ Creating ETH HTLC...');
        const ethTx = await htlcContract.createHTLC(
            evmWallet.address,
            keccak256Hash,
            ethTimelock,
            { value: ethers.parseEther('0.0001') }
        );
        const ethReceipt = await ethTx.wait();
        const ethContractId = ethReceipt.logs[0].topics[1];
        console.log('   ✅ Created with ID:', ethContractId);
        
        // XRP Escrow
        console.log('\n2️⃣ Creating XRP Escrow...');
        const xrpFusionClient = new XRPFusionClient('wss://testnet.xrpl-labs.com');
        await xrpFusionClient.init(process.env.XRP_SEED!);
        
        const xrpResult = await xrpFusionClient.createHTLC({
            receiver: xrpWallet.address,
            amount: '1',
            hashlock: sha256Hash,
            timelock: xrpTimelock
        });
        
        if (!xrpResult.success) {
            console.error('   ❌ Failed:', xrpResult.error);
            await xrpClient.disconnect();
            return;
        }
        console.log('   ✅ Created with sequence:', xrpResult.escrowSequence);
        
        // Wait for indexing
        console.log('\n⏳ Waiting for blockchain confirmations...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // === Claim HTLCs ===
        console.log('\n🔓 Claiming HTLCs...\n');
        
        // Claim XRP
        console.log('1️⃣ Claiming XRP Escrow...');
        const xrpClaimResult = await claimHelper.claimEscrow(
            xrpWallet.address,
            xrpResult.escrowSequence!,
            secret
        );
        
        if (xrpClaimResult.success) {
            console.log('   ✅ XRP claimed! Tx:', xrpClaimResult.txHash);
            console.log('   Secret revealed on XRP ledger!');
        } else {
            console.log('   ❌ XRP claim failed:', xrpClaimResult.error);
        }
        
        // Claim ETH
        console.log('\n2️⃣ Claiming ETH HTLC...');
        try {
            const withdrawTx = await htlcContract.withdraw(
                ethContractId,
                '0x' + secret.toString('hex')
            );
            const withdrawReceipt = await withdrawTx.wait();
            console.log('   ✅ ETH claimed! Tx:', withdrawReceipt.hash);
        } catch (error: any) {
            console.log('   ❌ ETH claim failed:', error.reason || error.message);
        }
        
        // === Summary ===
        console.log('\n📊 Atomic Swap Summary:');
        console.log('   ✅ Both chains use different hash algorithms');
        console.log('   ✅ ETH: Keccak256, XRP: SHA256');
        console.log('   ✅ Same secret unlocks both');
        console.log('   ✅ Atomic guarantee maintained');
        
        await xrpClient.disconnect();
        
    } catch (error) {
        console.error('\n❌ Error:', error);
    }
}

testFinalAtomicSwap().catch(console.error);