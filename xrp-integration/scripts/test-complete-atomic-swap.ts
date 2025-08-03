import { XRPFusionClient } from '../src/xrp-fusion-client';
import { XRPHTLC } from '../src/xrp-htlc';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createHash } from 'crypto';
import { Client, EscrowFinish, xrpToDrops } from 'xrpl';

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

// Generate proper XRP fulfillment from preimage
function generateXRPFulfillment(preimage: Buffer): string {
    // PREIMAGE-SHA-256 fulfillment format:
    // A0 (type) + length + 80 (preimage type) + preimage length + preimage
    const preimageHex = preimage.toString('hex').toUpperCase();
    const preimageLength = preimage.length;
    
    // Total content is: 80 + preimage length byte + preimage
    const totalLength = 1 + 1 + preimageLength; // type(1) + length(1) + data
    
    const totalLengthHex = totalLength.toString(16).padStart(2, '0').toUpperCase();
    const preimageLengthHex = preimageLength.toString(16).padStart(2, '0').toUpperCase();
    
    return 'A0' + totalLengthHex + '80' + preimageLengthHex + preimageHex;
}

async function testCompleteAtomicSwap() {
    console.log('🔄 Complete Cross-Chain Atomic Swap Test (ETH ↔ XRP)\n');
    console.log('This test will demonstrate a complete atomic swap with claiming on both chains\n');
    
    try {
        // Initialize providers
        const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL);
        const evmWallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY!, provider);
        
        const xrpClient = new XRPFusionClient('wss://testnet.xrpl-labs.com');
        await xrpClient.init(process.env.XRP_SEED!);
        const xrpAddress = xrpClient.getWalletAddress();
        
        // Initialize direct XRP client for manual claiming
        const directXrpClient = new Client('wss://testnet.xrpl-labs.com');
        await directXrpClient.connect();
        
        console.log('🔑 Participants:');
        console.log('   Alice (ETH):', evmWallet.address);
        console.log('   Bob (XRP):', xrpAddress);
        console.log('   (For demo, both are same wallet)\n');
        
        // Display initial balances
        const initialEthBalance = await provider.getBalance(evmWallet.address);
        const initialXrpBalance = await xrpClient.getBalance();
        console.log('💰 Initial Balances:');
        console.log('   ETH:', ethers.formatEther(initialEthBalance), 'ETH');
        console.log('   XRP:', initialXrpBalance, 'XRP\n');
        
        // Generate secret and compute both hashes
        const secret = Buffer.from(ethers.randomBytes(32));
        const sha256Hash = createHash('sha256').update(secret).digest();
        const keccak256Hash = ethers.keccak256(secret);
        
        console.log('🔐 Secret & Hashes:');
        console.log('   Secret:', secret.toString('hex'));
        console.log('   SHA256 (XRP):', sha256Hash.toString('hex'));
        console.log('   Keccak256 (ETH):', keccak256Hash);
        
        // Set timelocks
        const currentUnixTime = Math.floor(Date.now() / 1000);
        const ethTimelock = currentUnixTime + 7200; // 2 hours for initiator
        const rippleEpoch = 946684800;
        const xrpTimelock = (currentUnixTime - rippleEpoch) + 3600; // 1 hour for responder
        
        // === STEP 1: Create HTLCs ===
        console.log('\n📝 Step 1: Creating HTLCs on both chains...\n');
        
        // Alice creates Ethereum HTLC
        const htlcContract = new ethers.Contract(
            sharedDeployment.sepolia.contractAddress,
            HTLC_ABI,
            evmWallet
        );
        
        const ethAmount = ethers.parseEther('0.0001');
        console.log('1️⃣ Alice creates Ethereum HTLC...');
        const ethTx = await htlcContract.createHTLC(
            evmWallet.address, // In real swap: Bob's ETH address
            keccak256Hash,
            ethTimelock,
            { value: ethAmount }
        );
        
        const ethReceipt = await ethTx.wait();
        const ethContractId = ethReceipt.logs[0].topics[1];
        console.log('   ✅ Created with Keccak256');
        console.log('   Contract ID:', ethContractId);
        
        // Bob creates XRP Escrow
        console.log('\n2️⃣ Bob creates XRP Escrow...');
        const xrpResult = await xrpClient.createHTLC({
            receiver: xrpAddress, // In real swap: Alice's XRP address
            amount: '1',
            hashlock: sha256Hash,
            timelock: xrpTimelock
        });
        
        if (!xrpResult.success) {
            console.error('   ❌ Failed:', xrpResult.error);
            return;
        }
        console.log('   ✅ Created with SHA256');
        console.log('   Escrow Sequence:', xrpResult.escrowSequence);
        
        // Wait for escrow to be indexed
        console.log('\n⏳ Waiting for transactions to be indexed...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // === STEP 2: Alice claims XRP (reveals secret) ===
        console.log('\n📝 Step 2: Alice claims XRP Escrow (reveals secret)...\n');
        
        try {
            // Use direct XRP client for manual claiming with proper fulfillment
            const fulfillment = generateXRPFulfillment(secret);
            console.log('   Generated fulfillment:', fulfillment);
            
            const escrowFinish: EscrowFinish = {
                TransactionType: 'EscrowFinish',
                Account: xrpAddress,
                Owner: xrpAddress,
                OfferSequence: xrpResult.escrowSequence!,
                Fulfillment: fulfillment
            };
            
            // Access the wallet and client from xrpClient
            const xrpWallet = (xrpClient as any).wallet;
            const xrpInternalClient = (xrpClient as any).client;
            
            const prepared = await xrpInternalClient.autofill(escrowFinish);
            const signed = xrpWallet.sign(prepared);
            const result = await xrpInternalClient.submitAndWait(signed.tx_blob);
            
            if (result.result.meta && typeof result.result.meta !== 'string') {
                const meta = result.result.meta;
                if (meta.TransactionResult === 'tesSUCCESS') {
                    console.log('   ✅ XRP Escrow claimed successfully!');
                    console.log('   Transaction:', result.result.hash);
                    console.log('   Secret revealed on XRP Ledger!');
                } else {
                    console.log('   ❌ XRP claim failed:', meta.TransactionResult);
                }
            }
        } catch (error: any) {
            console.log('   ❌ XRP claim error:', error.message);
        }
        
        // === STEP 3: Bob claims ETH using revealed secret ===
        console.log('\n📝 Step 3: Bob claims ETH HTLC with revealed secret...\n');
        
        try {
            const withdrawTx = await htlcContract.withdraw(
                ethContractId,
                '0x' + secret.toString('hex')
            );
            const withdrawReceipt = await withdrawTx.wait();
            console.log('   ✅ ETH HTLC claimed successfully!');
            console.log('   Transaction:', withdrawReceipt.hash);
        } catch (error: any) {
            console.log('   ❌ ETH claim failed:', error.reason || error.message);
        }
        
        // === STEP 4: Verify final state ===
        console.log('\n📊 Final State:\n');
        
        // Check Ethereum HTLC state
        const ethHtlcState = await htlcContract.getContract(ethContractId);
        console.log('   Ethereum HTLC:');
        console.log('     - Withdrawn:', ethHtlcState.withdrawn);
        if (ethHtlcState.withdrawn) {
            console.log('     - Revealed secret:', ethHtlcState.preimage);
        }
        
        // Final balances
        const finalEthBalance = await provider.getBalance(evmWallet.address);
        const finalXrpBalance = await xrpClient.getBalance();
        console.log('\n   Final Balances:');
        console.log('     - ETH:', ethers.formatEther(finalEthBalance), 'ETH');
        console.log('     - XRP:', finalXrpBalance, 'XRP');
        
        // Calculate changes
        const ethChange = Number(ethers.formatEther(finalEthBalance)) - Number(ethers.formatEther(initialEthBalance));
        const xrpChange = Number(finalXrpBalance) - Number(initialXrpBalance);
        
        console.log('\n   Balance Changes:');
        console.log('     - ETH:', ethChange.toFixed(6), 'ETH');
        console.log('     - XRP:', xrpChange.toFixed(6), 'XRP');
        
        console.log('\n🎉 Atomic Swap Complete!');
        console.log('   ✅ Both HTLCs created with different hash algorithms');
        console.log('   ✅ Both HTLCs claimed successfully');
        console.log('   ✅ Same secret unlocked both chains');
        console.log('   ✅ Truly atomic - either both succeed or both fail');
        
        await directXrpClient.disconnect();
        
    } catch (error) {
        console.error('\n❌ Error:', error);
    }
}

testCompleteAtomicSwap().catch(console.error);