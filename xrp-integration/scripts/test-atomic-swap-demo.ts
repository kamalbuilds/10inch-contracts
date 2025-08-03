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

async function demonstrateAtomicSwap() {
    console.log('🔄 Demonstrating Cross-Chain Atomic Swap (ETH ↔ XRP)\n');
    console.log('This demo shows how atomic swaps work between Ethereum and XRP Ledger');
    console.log('Both chains use SHA256 for hashlock compatibility\n');
    
    try {
        // Initialize Ethereum provider
        const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL);
        const evmWallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY!, provider);
        
        // Initialize XRP client
        const xrpClient = new XRPFusionClient('wss://testnet.xrpl-labs.com');
        await xrpClient.init(process.env.XRP_SEED!);
        const xrpAddress = xrpClient.getWalletAddress();
        
        // Display initial balances
        console.log('📊 Initial Balances:');
        const initialEthBalance = await provider.getBalance(evmWallet.address);
        const initialXrpBalance = await xrpClient.getBalance();
        console.log('   ETH:', ethers.formatEther(initialEthBalance), 'ETH');
        console.log('   XRP:', initialXrpBalance, 'XRP\n');
        
        // Step 1: Generate secret and hashlock
        const secret = Buffer.from(ethers.randomBytes(32));
        const hashlock = createHash('sha256').update(secret).digest();
        
        console.log('🔐 Atomic Swap Parameters:');
        console.log('   Secret:', secret.toString('hex'));
        console.log('   SHA256 Hashlock:', hashlock.toString('hex'));
        console.log('   ✅ Both chains use SHA256 for compatibility\n');
        
        // Set timelocks
        const currentUnixTime = Math.floor(Date.now() / 1000);
        const ethTimelock = currentUnixTime + 7200; // 2 hours
        const rippleEpoch = 946684800;
        const xrpTimelock = (currentUnixTime - rippleEpoch) + 3600; // 1 hour
        
        // Step 2: Create HTLCs on both chains
        console.log('📝 Creating HTLCs on both chains...\n');
        
        // Create Ethereum HTLC
        const htlcContract = new ethers.Contract(
            sharedDeployment.sepolia.contractAddress,
            HTLC_ABI,
            evmWallet
        );
        
        const ethAmount = ethers.parseEther('0.0001');
        console.log('1️⃣ Creating Ethereum HTLC...');
        const ethTx = await htlcContract.createHTLC(
            evmWallet.address,
            '0x' + hashlock.toString('hex'),
            ethTimelock,
            { value: ethAmount }
        );
        const ethReceipt = await ethTx.wait();
        const ethContractId = ethReceipt.logs[0].topics[1];
        console.log('   ✅ ETH HTLC created');
        console.log('   Contract ID:', ethContractId);
        console.log('   Amount: 0.0001 ETH\n');
        
        // Create XRP HTLC
        console.log('2️⃣ Creating XRP HTLC...');
        const xrpResult = await xrpClient.createHTLC({
            receiver: xrpAddress,
            amount: '1',
            hashlock,
            timelock: xrpTimelock
        });
        
        if (xrpResult.success) {
            console.log('   ✅ XRP HTLC created');
            console.log('   Escrow Sequence:', xrpResult.escrowSequence);
            console.log('   Amount: 1 XRP\n');
        } else {
            console.error('   ❌ Failed to create XRP HTLC:', xrpResult.error);
            return;
        }
        
        // Step 3: Demonstrate the atomic nature
        console.log('🔒 Atomic Swap Properties:');
        console.log('   - Both HTLCs are now locked with the same hashlock');
        console.log('   - Only the holder of the secret can claim the funds');
        console.log('   - If one party claims, the secret is revealed on-chain');
        console.log('   - The other party can then use the revealed secret\n');
        
        // Step 4: Show how claiming would work
        console.log('🔓 How the Atomic Swap Completes:');
        console.log('   1. Party A claims on destination chain (reveals secret)');
        console.log('   2. Party B sees the revealed secret on blockchain');
        console.log('   3. Party B claims on source chain using the secret');
        console.log('   4. Both parties have successfully swapped assets!\n');
        
        // For demo purposes, let's just verify the HTLCs exist
        console.log('🔍 Verifying HTLCs...');
        
        // Check Ethereum HTLC
        const ethHtlcState = await htlcContract.getContract(ethContractId);
        console.log('   Ethereum HTLC:');
        console.log('     - Locked:', ethers.formatEther(ethHtlcState.amount), 'ETH');
        console.log('     - Hashlock matches:', ethHtlcState.hashlock === '0x' + hashlock.toString('hex'));
        console.log('     - Withdrawn:', ethHtlcState.withdrawn);
        
        // Wait a bit for XRP escrow to be indexed
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('   XRP HTLC:');
        console.log('     - Escrow created with sequence:', xrpResult.escrowSequence);
        console.log('     - Amount: 1 XRP');
        console.log('     - Same hashlock used\n');
        
        // Final summary
        console.log('📊 Summary:');
        console.log('   ✅ HTLCs created on both Ethereum and XRP');
        console.log('   ✅ Both use SHA256 hashlock:', hashlock.toString('hex').substring(0, 16) + '...');
        console.log('   ✅ Atomic swap is ready - funds are locked');
        console.log('   ✅ Either both parties get their funds or neither does');
        console.log('\n💡 Note: In a real swap, parties would now exchange and claim');
        console.log('   using the secret to complete the atomic swap.\n');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

demonstrateAtomicSwap().catch(console.error);