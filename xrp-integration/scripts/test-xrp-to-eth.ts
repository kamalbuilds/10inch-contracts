import { XRPFusionClient } from '../src/xrp-fusion-client';
import { XRPHTLC } from '../src/xrp-htlc';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load shared deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

const HTLC_ABI = [
    "function createHTLC(bytes32 _hashlock, uint256 _timelock, address _receiver) payable returns (bytes32)",
    "function withdraw(bytes32 _contractId, bytes32 _secret)",
    "function getContract(bytes32 _contractId) view returns (tuple(address sender, address receiver, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded))"
];

async function testXRPToETH() {
    console.log('🔄 Testing XRP to Ethereum Cross-Chain Swap\n');
    
    try {
        // Initialize XRP client
        const xrpClient = new XRPFusionClient('wss://testnet.xrpl-labs.com');
        await xrpClient.init(process.env.XRP_SEED!);
        
        const xrpAddress = xrpClient.getWalletAddress();
        console.log('📍 XRP Address:', xrpAddress);
        
        const xrpBalance = await xrpClient.getBalance();
        console.log('💰 XRP Balance:', xrpBalance, 'XRP\n');
        
        // Initialize Ethereum provider
        const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL);
        const evmWallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY!, provider);
        console.log('📍 ETH Address:', evmWallet.address);
        
        const ethBalance = await provider.getBalance(evmWallet.address);
        console.log('💰 ETH Balance:', ethers.formatEther(ethBalance), 'ETH\n');
        
        // Step 1: Generate secret and hashlock
        const { secret, hashlock } = XRPHTLC.generateSecret();
        console.log('🔐 Generated secret:', secret.toString('hex'));
        console.log('🔒 Hashlock:', hashlock.toString('hex'));
        
        // XRP uses Ripple time, ETH uses Unix time
        const currentUnixTime = Math.floor(Date.now() / 1000);
        const rippleEpoch = 946684800;
        const xrpTimelock = (currentUnixTime - rippleEpoch) + 3600; // 1 hour in Ripple time
        const ethTimelock = currentUnixTime + 3600; // 1 hour in Unix time
        
        // Step 2: Create HTLC on XRP
        console.log('\n📝 Creating HTLC on XRP Ledger...');
        const xrpResult = await xrpClient.createHTLC({
            receiver: xrpAddress, // Send to self for demo
            amount: '10', // 10 XRP
            hashlock,
            timelock: xrpTimelock
        });
        
        if (!xrpResult.success) {
            console.error('❌ Failed to create XRP HTLC:', xrpResult.error);
            return;
        }
        
        console.log('✅ XRP HTLC created!');
        console.log('   Escrow Sequence:', xrpResult.escrowSequence);
        
        // Step 3: Create corresponding HTLC on Ethereum
        console.log('\n📝 Creating HTLC on Ethereum...');
        const htlcContract = new ethers.Contract(
            sharedDeployment.sepolia.contractAddress,
            HTLC_ABI,
            evmWallet
        );
        
        const ethAmount = ethers.parseEther('0.01'); // 0.01 ETH
        const tx = await htlcContract.createHTLC(
            '0x' + hashlock.toString('hex'),
            ethTimelock,
            evmWallet.address, // Send to self for demo
            { value: ethAmount }
        );
        
        console.log('⏳ Waiting for transaction confirmation...');
        const receipt = await tx.wait();
        
        // Get contract ID from event
        const event = receipt.logs[0];
        const contractId = event.topics[1];
        console.log('✅ ETH HTLC created!');
        console.log('   Contract ID:', contractId);
        console.log('   Transaction:', receipt.hash);
        
        // Step 4: Claim XRP HTLC
        console.log('\n🔓 Claiming XRP HTLC with secret...');
        const claimResult = await xrpClient.claimHTLC(
            xrpAddress,
            xrpResult.escrowSequence!,
            secret
        );
        
        if (claimResult.success) {
            console.log('✅ XRP HTLC claimed!');
            console.log('   Transaction:', claimResult.txHash);
        } else {
            console.error('❌ Failed to claim XRP HTLC:', claimResult.error);
        }
        
        // Step 5: Claim ETH HTLC
        console.log('\n🔓 Claiming ETH HTLC with secret...');
        const withdrawTx = await htlcContract.withdraw(
            contractId,
            '0x' + secret.toString('hex')
        );
        
        const withdrawReceipt = await withdrawTx.wait();
        console.log('✅ ETH HTLC claimed!');
        console.log('   Transaction:', withdrawReceipt.hash);
        
        // Final balances
        console.log('\n📊 Final Balances:');
        const finalXrpBalance = await xrpClient.getBalance();
        console.log('   XRP:', finalXrpBalance, 'XRP');
        
        const finalEthBalance = await provider.getBalance(evmWallet.address);
        console.log('   ETH:', ethers.formatEther(finalEthBalance), 'ETH');
        
        console.log('\n🎉 Cross-chain swap completed successfully!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testXRPToETH().catch(console.error);