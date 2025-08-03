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
    "function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32)",
    "function withdraw(bytes32 _contractId, bytes32 _preimage)",
    "function getContract(bytes32 _contractId) view returns (address sender, address receiver, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, bytes32 preimage)"
];

async function testXRPToETH() {
    console.log('🔄 Testing XRP to Ethereum Cross-Chain Swap (Simplified)\n');
    
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
        
        // Set timelocks
        const currentUnixTime = Math.floor(Date.now() / 1000);
        const rippleEpoch = 946684800;
        const xrpTimelock = (currentUnixTime - rippleEpoch) + 7200; // 2 hours for initiator
        const ethTimelock = currentUnixTime + 3600; // 1 hour for responder
        
        // Step 2: Create HTLC on XRP (initiator locks first)
        console.log('\n📝 Creating HTLC on XRP Ledger...');
        const xrpResult = await xrpClient.createHTLC({
            receiver: xrpAddress, // Send to self for demo
            amount: '1', // 1 XRP
            hashlock,
            timelock: xrpTimelock
        });
        
        if (!xrpResult.success) {
            console.error('❌ Failed to create XRP HTLC:', xrpResult.error);
            return;
        }
        
        console.log('✅ XRP HTLC created!');
        console.log('   Escrow Sequence:', xrpResult.escrowSequence);
        
        // Step 3: Create corresponding HTLC on Ethereum (responder)
        console.log('\n📝 Creating HTLC on Ethereum...');
        const htlcContract = new ethers.Contract(
            sharedDeployment.sepolia.contractAddress,
            HTLC_ABI,
            evmWallet
        );
        
        const ethAmount = ethers.parseEther('0.0001'); // 0.0001 ETH
        const tx = await htlcContract.createHTLC(
            evmWallet.address, // receiver
            '0x' + hashlock.toString('hex'), // hashlock
            ethTimelock, // timelock
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
        
        // For demo purposes, we'll just show the swap was set up successfully
        console.log('\n🎉 Cross-chain swap HTLCs created successfully!');
        console.log('   XRP Escrow Sequence:', xrpResult.escrowSequence);
        console.log('   ETH HTLC Contract ID:', contractId);
        console.log('\n📝 In a real swap:');
        console.log('   1. Initiator would claim ETH HTLC with secret');
        console.log('   2. Responder would see revealed secret on Ethereum');
        console.log('   3. Responder would claim XRP escrow with the secret');
        
        // Final balances
        console.log('\n📊 Final Balances:');
        const finalXrpBalance = await xrpClient.getBalance();
        console.log('   XRP:', finalXrpBalance, 'XRP (locked 1 XRP)');
        
        const finalEthBalance = await provider.getBalance(evmWallet.address);
        console.log('   ETH:', ethers.formatEther(finalEthBalance), 'ETH (locked 0.0001 ETH)');
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testXRPToETH().catch(console.error);