import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load deployed contract info
const deploymentInfo = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sepolia-htlc-deployment.json'), 'utf-8')
);

const HTLC_CONTRACT = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';
const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com';

async function demonstrateSepoliaHTLC() {
    console.log('🔄 Demonstrating SimpleHTLC on Sepolia\n');
    
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
    const wallet = process.env.SEPOLIA_PRIVATE_KEY 
        ? new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY, provider)
        : null;

    console.log('📍 HTLC Contract:', HTLC_CONTRACT);
    console.log('🔗 View on Etherscan: https://sepolia.etherscan.io/address/' + HTLC_CONTRACT);
    
    if (wallet) {
        console.log('📍 Wallet Address:', wallet.address);
        const balance = await provider.getBalance(wallet.address);
        console.log('💰 Balance:', ethers.formatEther(balance), 'ETH');
    } else {
        console.log('⚠️  No wallet configured - read-only mode');
    }

    // Generate test values
    const secret = ethers.randomBytes(32);
    const secretHex = ethers.hexlify(secret);
    const hashlock = ethers.keccak256(secret);
    const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    
    console.log('\n🔐 Test Parameters:');
    console.log('Secret:', secretHex);
    console.log('Hashlock:', hashlock);
    console.log('Timelock:', new Date(timelock * 1000).toISOString());

    if (wallet) {
        try {
            // Connect to contract
            const htlcContract = new ethers.Contract(
                HTLC_CONTRACT,
                deploymentInfo.abi,
                wallet
            );

            // Create HTLC
            console.log('\n📝 Creating HTLC...');
            const receiver = wallet.address; // Self for demo
            const amount = ethers.parseEther('0.001'); // 0.001 ETH
            
            const createTx = await htlcContract.createHTLC(
                receiver,
                hashlock,
                timelock,
                { value: amount }
            );
            
            console.log('Transaction sent:', createTx.hash);
            const createReceipt = await createTx.wait();
            console.log('✅ HTLC created!');
            
            // Get contract ID from event
            const htlcCreatedEvent = createReceipt.logs.find(
                (log: any) => {
                    try {
                        const parsed = htlcContract.interface.parseLog(log);
                        return parsed?.name === 'HTLCCreated';
                    } catch {
                        return false;
                    }
                }
            );
            
            const parsedEvent = htlcContract.interface.parseLog(htlcCreatedEvent);
            const contractId = parsedEvent?.args?.contractId;
            console.log('Contract ID:', contractId);
            
            // Check contract details
            const details = await htlcContract.getContract(contractId);
            console.log('\n📋 HTLC Details:');
            console.log('- Sender:', details.sender);
            console.log('- Receiver:', details.receiver);
            console.log('- Amount:', ethers.formatEther(details.amount), 'ETH');
            console.log('- Hashlock:', details.hashlock);
            console.log('- Timelock:', new Date(Number(details.timelock) * 1000).toISOString());
            console.log('- Withdrawn:', details.withdrawn);
            console.log('- Refunded:', details.refunded);
            
            // Withdraw with secret
            console.log('\n🔓 Withdrawing with secret...');
            const withdrawTx = await htlcContract.withdraw(contractId, secretHex);
            console.log('Transaction sent:', withdrawTx.hash);
            await withdrawTx.wait();
            console.log('✅ Funds withdrawn!');
            
            // Check final state
            const finalDetails = await htlcContract.getContract(contractId);
            console.log('\n📋 Final HTLC State:');
            console.log('- Withdrawn:', finalDetails.withdrawn);
            console.log('- Preimage:', finalDetails.preimage);
            
        } catch (error: any) {
            console.error('\n❌ Error:', error.message);
        }
    } else {
        // Read-only demonstration
        console.log('\n📖 Read-Only Demo (no wallet configured)');
        console.log('\nThis is how cross-chain swaps work:');
        console.log('1. User on Sui creates an order with a hashlock');
        console.log('2. Resolver accepts order and locks SUI with same hashlock');
        console.log('3. Resolver creates HTLC on Sepolia with same hashlock');
        console.log('4. User reveals secret on Sepolia to claim ETH');
        console.log('5. Resolver uses revealed secret to claim SUI');
        console.log('\nThe deployed contract at', HTLC_CONTRACT, 'can be used by:');
        console.log('- Sui integration');
        console.log('- Aptos integration');
        console.log('- TON integration');
        console.log('- Any other non-EVM chain integration');
    }

    console.log('\n🎯 Integration Instructions:');
    console.log('1. Use this contract address in your non-EVM chain tests');
    console.log('2. Create HTLCs with matching hashlocks on both chains');
    console.log('3. Reveal secret on one chain to claim funds');
    console.log('4. Use revealed secret to claim on the other chain');
    console.log('\n📝 Contract Address for all integrations:', HTLC_CONTRACT);
}

// Run demonstration
demonstrateSepoliaHTLC()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });