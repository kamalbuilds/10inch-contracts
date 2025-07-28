import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { 
    TEST_CONFIG, 
    getSuiKeypair, 
    getEthereumWallet, 
    generateSecretAndHash,
    calculateTimelock 
} from './test-config';

// Load deployed contract ABI
const deploymentInfo = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'sepolia-htlc-deployment.json'), 'utf-8')
);

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string
): Promise<T> {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await operation();
        } catch (error: any) {
            console.error(`❌ Attempt ${i + 1} failed for ${operationName}:`, error.message);
            if (i < MAX_RETRIES - 1) {
                console.log(`⏳ Retrying in ${RETRY_DELAY / 1000} seconds...`);
                await sleep(RETRY_DELAY);
            } else {
                throw error;
            }
        }
    }
    throw new Error(`Failed after ${MAX_RETRIES} attempts`);
}

async function testWithRetry() {
    console.log('🔄 Testing Cross-Chain Swaps with Retry Logic\n');
    console.log('📍 Sepolia HTLC:', TEST_CONFIG.sepolia.htlcContract);
    console.log('📍 Sui Package:', TEST_CONFIG.sui.packageId);
    console.log('\n' + '='.repeat(80) + '\n');

    // Initialize Ethereum (always works)
    const ethWallet = getEthereumWallet();
    if (!ethWallet) {
        console.error('❌ Error: SEPOLIA_PRIVATE_KEY not found in .env');
        return;
    }
    
    const ethAddress = await ethWallet.getAddress();
    const provider = ethWallet.provider!;
    const htlcContract = new ethers.Contract(
        TEST_CONFIG.sepolia.htlcContract,
        deploymentInfo.abi,
        ethWallet
    );

    console.log('✅ Ethereum Connection Established');
    console.log('📍 Wallet:', ethAddress);
    const ethBalance = await provider.getBalance(ethAddress);
    console.log('💰 Balance:', ethers.formatEther(ethBalance), 'ETH');

    // Try to connect to Sui
    console.log('\n🔄 Attempting to connect to Sui...');
    const suiKeypair = getSuiKeypair();
    const suiAddress = suiKeypair.getPublicKey().toSuiAddress();
    console.log('📍 Sui Address:', suiAddress);
    
    // Test different Sui RPC endpoints
    const suiEndpoints = [
        TEST_CONFIG.sui.rpcUrl,
        'https://sui-testnet.public.blastapi.io',
        'https://rpc.testnet.sui.io',
        'https://fullnode.testnet.sui.io',
    ];

    let suiClient: SuiClient | null = null;
    
    for (const endpoint of suiEndpoints) {
        console.log(`\n🔗 Trying Sui RPC: ${endpoint}`);
        try {
            const client = new SuiClient({ url: endpoint });
            const balance = await client.getBalance({ owner: suiAddress });
            console.log('✅ Connected! Balance:', Number(balance.totalBalance) / 1e9, 'SUI');
            suiClient = client;
            break;
        } catch (error: any) {
            console.error('❌ Failed:', error.message);
        }
    }

    if (!suiClient) {
        console.log('\n⚠️  Could not connect to Sui network');
        console.log('🔄 Proceeding with Sepolia-only demonstration...\n');
        await demonstrateSepoliaOnly(htlcContract, ethAddress);
        return;
    }

    // If we get here, both connections work!
    console.log('\n✅ Both networks connected! Running full cross-chain test...\n');
    
    // Run the full test with the working Sui client
    await runFullCrossChainTest(suiClient, htlcContract, suiKeypair, ethWallet);
}

async function demonstrateSepoliaOnly(htlcContract: ethers.Contract, ethAddress: string) {
    console.log('=' + '='.repeat(60));
    console.log('🔄 SEPOLIA HTLC DEMONSTRATION');
    console.log('=' + '='.repeat(60) + '\n');
    
    const secret = ethers.randomBytes(32);
    const secretHex = ethers.hexlify(secret);
    const hashlock = ethers.keccak256(secret);
    const timelock = Math.floor(Date.now() / 1000) + 3600;
    
    console.log('🔐 HTLC Parameters:');
    console.log('- Secret:', secretHex);
    console.log('- Hashlock:', hashlock);
    console.log('- Amount: 0.001 ETH');
    
    try {
        // Create HTLC
        console.log('\n📝 Creating HTLC...');
        const createTx = await htlcContract.createHTLC(
            ethAddress,
            hashlock,
            timelock,
            { value: ethers.parseEther('0.001') }
        );
        
        const receipt = await createTx.wait();
        const event = receipt.logs.find((log: any) => {
            try {
                const parsed = htlcContract.interface.parseLog(log);
                return parsed?.name === 'HTLCCreated';
            } catch {
                return false;
            }
        });
        
        const parsed = htlcContract.interface.parseLog(event);
        const contractId = parsed?.args?.contractId;
        
        console.log('✅ HTLC created!');
        console.log('- Contract ID:', contractId);
        console.log('- Transaction:', createTx.hash);
        console.log('- View on Etherscan: https://sepolia.etherscan.io/tx/' + createTx.hash);
        
        // Withdraw
        console.log('\n🔓 Withdrawing with secret...');
        const withdrawTx = await htlcContract.withdraw(contractId, secretHex);
        await withdrawTx.wait();
        
        console.log('✅ Funds withdrawn!');
        console.log('- Transaction:', withdrawTx.hash);
        console.log('- View on Etherscan: https://sepolia.etherscan.io/tx/' + withdrawTx.hash);
        
        console.log('\n💡 In a real cross-chain swap:');
        console.log('1. This HTLC would be created by a resolver');
        console.log('2. The user would reveal the secret to claim funds');
        console.log('3. The resolver would use the secret on the other chain');
        
    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }
}

async function runFullCrossChainTest(
    suiClient: SuiClient,
    htlcContract: ethers.Contract,
    suiKeypair: any,
    ethWallet: ethers.Wallet
) {
    const suiAddress = suiKeypair.getPublicKey().toSuiAddress();
    const ethAddress = await ethWallet.getAddress();
    
    // Generate swap parameters
    const { secret, hashlock, hashlockBytes } = generateSecretAndHash();
    const timelock = calculateTimelock();
    
    console.log('🔐 Swap Parameters:');
    console.log('- Secret:', secret);
    console.log('- Hashlock:', hashlock);
    console.log('- Amount: 0.001 ETH ↔ 0.1 SUI');
    
    try {
        // Create HTLC on Sepolia first (simpler)
        console.log('\n📝 Creating HTLC on Sepolia...');
        const createTx = await htlcContract.createHTLC(
            ethAddress,
            hashlock,
            Math.floor(timelock / 1000),
            { value: ethers.parseEther('0.001') }
        );
        
        await createTx.wait();
        console.log('✅ HTLC created on Sepolia!');
        console.log('- Transaction:', createTx.hash);
        console.log('- View: https://sepolia.etherscan.io/tx/' + createTx.hash);
        
        // Try Sui operations with retry
        console.log('\n📤 Creating order on Sui...');
        const orderTxb = new TransactionBlock();
        orderTxb.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::create_outbound_order`,
            arguments: [
                orderTxb.object(TEST_CONFIG.sui.swapRegistry),
                orderTxb.pure(TEST_CONFIG.sepolia.chainId, 'u64'),
                orderTxb.pure(suiAddress, 'address'),
                orderTxb.pure(TEST_CONFIG.testAmount.sui, 'u64'),
                orderTxb.pure(hashlockBytes, 'vector<u8>'),
                orderTxb.pure(timelock, 'u64'),
                orderTxb.object('0x6'),
            ],
        });

        const orderResult = await retryOperation(
            () => suiClient.signAndExecuteTransactionBlock({
                signer: suiKeypair,
                transactionBlock: orderTxb,
                options: { showEvents: true }
            }),
            'Create Sui order'
        );
        
        console.log('✅ Order created on Sui!');
        console.log('- Transaction:', orderResult.digest);
        
    } catch (error: any) {
        console.error('❌ Test failed:', error.message);
    }
}

// Run the test
testWithRetry()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });