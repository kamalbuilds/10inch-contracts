import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// Load deployed contract ABI
const deploymentInfo = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sepolia-htlc-deployment.json'), 'utf-8')
);

const HTLC_ADDRESS = '0x067423CA883d8D54995735aDc1FA23c17e5b62cc';

async function demonstrateSepoliaHTLC() {
    console.log('🔄 Demonstrating Sepolia HTLC for Cross-Chain Swaps\n');
    
    const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com');
    
    if (!process.env.SEPOLIA_PRIVATE_KEY) {
        console.error('❌ Error: SEPOLIA_PRIVATE_KEY not found in .env');
        return;
    }
    
    const wallet = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY, provider);
    const htlcContract = new ethers.Contract(HTLC_ADDRESS, deploymentInfo.abi, wallet);
    
    console.log('📍 HTLC Contract:', HTLC_ADDRESS);
    console.log('📍 Wallet:', wallet.address);
    console.log('🔗 Contract on Etherscan: https://sepolia.etherscan.io/address/' + HTLC_ADDRESS);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log('💰 Balance:', ethers.formatEther(balance), 'ETH\n');

    // Part 1: Simulate Sui → Sepolia
    console.log('=' + '='.repeat(60));
    console.log('🔄 PART 1: Simulating Sui → Sepolia Swap');
    console.log('=' + '='.repeat(60) + '\n');
    
    // Generate parameters
    const secret1 = ethers.randomBytes(32);
    const secretHex1 = ethers.hexlify(secret1);
    const hashlock1 = ethers.keccak256(secret1);
    const timelock1 = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    console.log('🔐 Swap Parameters:');
    console.log('- Secret:', secretHex1);
    console.log('- Hashlock:', hashlock1);
    console.log('- Timelock:', new Date(timelock1 * 1000).toISOString());
    console.log('- Amount: 0.001 ETH (representing swapped value from 0.1 SUI)');
    
    try {
        // Step 1: Resolver creates HTLC
        console.log('\n📝 Step 1: Resolver creating HTLC on Sepolia...');
        const createTx1 = await htlcContract.createHTLC(
            wallet.address, // User's Ethereum address
            hashlock1,
            timelock1,
            { value: ethers.parseEther('0.001') }
        );
        
        console.log('⏳ Waiting for confirmation...');
        const receipt1 = await createTx1.wait();
        
        // Get contract ID from event
        const event1 = receipt1.logs.find((log: any) => {
            try {
                const parsed = htlcContract.interface.parseLog(log);
                return parsed?.name === 'HTLCCreated';
            } catch {
                return false;
            }
        });
        
        const parsed1 = htlcContract.interface.parseLog(event1);
        const contractId1 = parsed1?.args?.contractId;
        
        console.log('✅ HTLC created!');
        console.log('- Contract ID:', contractId1);
        console.log('- Transaction:', createTx1.hash);
        console.log('- Block:', receipt1.blockNumber);
        
        // Check contract details
        const details1 = await htlcContract.getContract(contractId1);
        console.log('\n📋 HTLC Details:');
        console.log('- Sender (Resolver):', details1.sender);
        console.log('- Receiver (User):', details1.receiver);
        console.log('- Amount:', ethers.formatEther(details1.amount), 'ETH');
        console.log('- Status: Locked, waiting for secret');
        
        // Step 2: User withdraws with secret
        console.log('\n🔓 Step 2: User revealing secret to claim ETH...');
        const withdrawTx1 = await htlcContract.withdraw(contractId1, secretHex1);
        await withdrawTx1.wait();
        
        console.log('✅ ETH withdrawn!');
        console.log('- Transaction:', withdrawTx1.hash);
        console.log('- Secret revealed on-chain:', secretHex1);
        
        console.log('\n💡 In real swap: Resolver now uses this secret to claim 0.1 SUI on Sui network');
        
    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }

    // Part 2: Simulate Sepolia → Sui
    console.log('\n' + '='.repeat(60));
    console.log('🔄 PART 2: Simulating Sepolia → Sui Swap');
    console.log('=' + '='.repeat(60) + '\n');
    
    // Generate new parameters
    const secret2 = ethers.randomBytes(32);
    const secretHex2 = ethers.hexlify(secret2);
    const hashlock2 = ethers.keccak256(secret2);
    const timelock2 = Math.floor(Date.now() / 1000) + 3600;
    
    console.log('🔐 Swap Parameters:');
    console.log('- Secret:', secretHex2);
    console.log('- Hashlock:', hashlock2);
    console.log('- Timelock:', new Date(timelock2 * 1000).toISOString());
    console.log('- Amount: 0.001 ETH (to be swapped for 0.1 SUI)');
    
    try {
        // Step 1: User creates HTLC
        console.log('\n📝 Step 1: User creating HTLC on Sepolia...');
        const createTx2 = await htlcContract.createHTLC(
            wallet.address, // Resolver's Ethereum address
            hashlock2,
            timelock2,
            { value: ethers.parseEther('0.001') }
        );
        
        console.log('⏳ Waiting for confirmation...');
        const receipt2 = await createTx2.wait();
        
        // Get contract ID
        const event2 = receipt2.logs.find((log: any) => {
            try {
                const parsed = htlcContract.interface.parseLog(log);
                return parsed?.name === 'HTLCCreated';
            } catch {
                return false;
            }
        });
        
        const parsed2 = htlcContract.interface.parseLog(event2);
        const contractId2 = parsed2?.args?.contractId;
        
        console.log('✅ HTLC created!');
        console.log('- Contract ID:', contractId2);
        console.log('- Transaction:', createTx2.hash);
        console.log('- Block:', receipt2.blockNumber);
        
        console.log('\n💡 In real swap:');
        console.log('1. Resolver creates matching HTLC on Sui with 0.1 SUI');
        console.log('2. User reveals secret on Sui to claim SUI');
        console.log('3. Resolver uses revealed secret to claim ETH here');
        
        // Step 2: Simulate resolver withdrawal
        console.log('\n🔓 Step 2: Simulating resolver claiming ETH with secret...');
        const withdrawTx2 = await htlcContract.withdraw(contractId2, secretHex2);
        await withdrawTx2.wait();
        
        console.log('✅ ETH withdrawn by resolver!');
        console.log('- Transaction:', withdrawTx2.hash);
        console.log('- Secret used:', secretHex2);
        
    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('=' + '='.repeat(60) + '\n');
    
    console.log('✅ Demonstrated both swap directions on Sepolia');
    console.log('✅ Contract supports atomic swaps with any chain');
    console.log('✅ Uses keccak256 for hash validation');
    console.log('✅ Time-locked for security');
    
    console.log('\n📋 Token Support:');
    console.log('Currently Supported:');
    console.log('- Sepolia: ETH (native)');
    console.log('- Sui: SUI (native)');
    
    console.log('\nCan be Extended to Support:');
    console.log('- ERC20 tokens on Ethereum (USDC, USDT, WETH, etc.)');
    console.log('- Any Coin<T> type on Sui');
    console.log('- Wrapped tokens on both chains');
    
    console.log('\n🔗 Integration with Other Chains:');
    console.log('This same contract can be used by:');
    console.log('- Aptos (APT ↔ ETH)');
    console.log('- TON (TON ↔ ETH)');
    console.log('- Stellar (XLM ↔ ETH)');
    console.log('- Tron (TRX ↔ ETH)');
    console.log('- Any other non-EVM chain');
    
    // Check final balance
    const finalBalance = await provider.getBalance(wallet.address);
    console.log('\n💰 Final Balance:', ethers.formatEther(finalBalance), 'ETH');
}

// Run demonstration
demonstrateSepoliaHTLC()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });