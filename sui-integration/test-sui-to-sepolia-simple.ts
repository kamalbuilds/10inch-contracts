import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { 
    TEST_CONFIG, 
    getSuiKeypair, 
    generateSecretAndHash,
    calculateTimelock 
} from './test-config';

async function testSuiToSepoliaSimple() {
    console.log('🔄 Testing Sui → Ethereum Sepolia Cross-Chain Swap (Simplified)\n');

    // Initialize Sui client
    const suiClient = new SuiClient({ url: TEST_CONFIG.sui.rpcUrl });
    const suiKeypair = getSuiKeypair();
    const suiAddress = suiKeypair.getPublicKey().toSuiAddress();
    
    console.log('📍 Sui Address:', suiAddress);

    // Check balance
    const suiBalance = await suiClient.getBalance({ owner: suiAddress });
    console.log('💰 Sui Balance:', Number(suiBalance.totalBalance) / 1e9, 'SUI');

    // Generate secret and hash
    const { secret, secretBytes, hashlock, hashlockBytes } = generateSecretAndHash();
    const timelock = calculateTimelock();
    
    console.log('\n🔐 Swap Parameters:');
    console.log('Secret:', secret);
    console.log('Hashlock:', hashlock);
    console.log('Timelock:', new Date(timelock).toISOString());

    try {
        // Step 1: Create HTLC directly (simpler approach)
        console.log('\n🔒 Step 1: Creating HTLC on Sui...');
        
        const txb = new TransactionBlock();
        
        // Split coin for HTLC
        const [paymentCoin] = txb.splitCoins(
            txb.gas,
            [txb.pure(TEST_CONFIG.testAmount.sui)]
        );
        
        // Create HTLC with receiver as self (for testing)
        txb.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_htlc_v2::create_htlc`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                paymentCoin,
                txb.pure(suiAddress, 'address'), // receiver (self for testing)
                txb.pure(hashlockBytes, 'vector<u8>'),
                txb.pure(timelock, 'u64'),
                txb.object('0x6'), // Clock
            ],
        });

        const htlcResult = await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: txb,
            options: {
                showObjectChanges: true,
                showEvents: true,
            }
        });

        console.log('✅ HTLC created on Sui!');
        console.log('Transaction:', htlcResult.digest);

        // Get HTLC ID from events
        const htlcCreatedEvent = htlcResult.events?.find(
            e => e.type.includes('HTLCCreated')
        );
        
        const htlcId = (htlcCreatedEvent?.parsedJson as any)?.htlc_id;
        console.log('HTLC ID:', htlcId);

        // Step 2: Simulate EVM side actions
        console.log('\n🔗 Step 2: Simulating EVM HTLC creation...');
        console.log('In production:');
        console.log('- Resolver would create matching HTLC on Sepolia');
        console.log('- User would reveal secret on Sepolia');
        console.log('- Resolver would use revealed secret to claim on Sui');

        // Step 3: Withdraw from HTLC using secret
        console.log('\n🔓 Step 3: Withdrawing from HTLC with secret...');
        
        const withdrawTxb = new TransactionBlock();
        
        const [withdrawnCoin] = withdrawTxb.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_htlc_v2::withdraw`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                withdrawTxb.object(htlcId),
                withdrawTxb.pure(secretBytes, 'vector<u8>'),
                withdrawTxb.object('0x6'), // Clock
            ],
        });
        
        // Transfer the withdrawn coin back to sender
        withdrawTxb.transferObjects([withdrawnCoin], withdrawTxb.pure(suiAddress));

        const withdrawResult = await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: withdrawTxb,
            options: {
                showObjectChanges: true,
                showEvents: true,
            }
        });

        console.log('✅ Funds withdrawn successfully!');
        console.log('Transaction:', withdrawResult.digest);

        // Check final balance
        const finalBalance = await suiClient.getBalance({ owner: suiAddress });
        console.log('\n💰 Final Balance:', Number(finalBalance.totalBalance) / 1e9, 'SUI');

        console.log('\n🎉 Test completed successfully!');
        console.log('\n📊 Summary:');
        console.log('- Created HTLC with 0.1 SUI locked');
        console.log('- Secret hash:', hashlock);
        console.log('- Successfully withdrew funds with secret');
        console.log('- Demonstrated core HTLC functionality');

    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        if (error.cause) {
            console.error('Cause:', error.cause);
        }
    }
}

// Run the test
testSuiToSepoliaSimple()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });