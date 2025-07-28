import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { ethers } from 'ethers';
import { 
    TEST_CONFIG, 
    getSuiKeypair, 
    getEthereumWallet, 
    generateSecretAndHash,
    calculateTimelock 
} from './test-config';
import EscrowFactoryABI from './contracts/EscrowFactory.json';
// import EscrowABI from './contracts/Escrow.json';

async function testSuiToSepolia() {
    console.log('🔄 Testing Sui → Ethereum Sepolia Cross-Chain Swap\n');

    // Initialize clients
    const suiClient = new SuiClient({ url: TEST_CONFIG.sui.rpcUrl });
    const suiKeypair = getSuiKeypair();
    const suiAddress = suiKeypair.getPublicKey().toSuiAddress();
    
    const ethWallet = getEthereumWallet();
    const ethAddress = ethWallet ? await ethWallet.getAddress() : ethers.Wallet.createRandom().address;

    console.log('📍 Sui Address:', suiAddress);
    console.log('📍 Ethereum Address:', ethAddress);

    // Check balances
    const suiBalance = await suiClient.getBalance({ owner: suiAddress });
    console.log('💰 Sui Balance:', Number(suiBalance.totalBalance) / 1e9, 'SUI');
    
    if (ethWallet) {
        const ethBalance = await ethWallet.provider!.getBalance(ethAddress);
        console.log('💰 Sepolia Balance:', ethers.formatEther(ethBalance), 'ETH');
    } else {
        console.log('💰 Sepolia Balance: (Simulation mode - no wallet connected)');
    }

    // Generate secret and hash
    const { secret, secretBytes, hashlock, hashlockBytes } = generateSecretAndHash();
    const timelock = calculateTimelock();
    
    console.log('\n🔐 Swap Parameters:');
    console.log('Secret:', secret);
    console.log('Hashlock:', hashlock);
    console.log('Timelock:', new Date(timelock).toISOString());

    // Step 1: Create outbound order on Sui
    console.log('\n📤 Step 1: Creating outbound order on Sui...');
    
    const txb = new TransactionBlock();
    
    // Convert Ethereum address to bytes for cross-chain identification
    // const ethAddressBytes = Array.from(ethers.getBytes(ethAddress));
    
    txb.moveCall({
        target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::create_outbound_order`,
        arguments: [
            txb.object(TEST_CONFIG.sui.swapRegistry),
            txb.pure(TEST_CONFIG.sepolia.chainId, 'u64'),
            txb.pure(suiAddress, 'address'), // Use Sui address format
            txb.pure(TEST_CONFIG.testAmount.sui, 'u64'),
            txb.pure(hashlockBytes, 'vector<u8>'),
            txb.pure(timelock, 'u64'),
            txb.object('0x6'), // Clock object
        ],
    });

    const orderResult = await suiClient.signAndExecuteTransactionBlock({
        signer: suiKeypair,
        transactionBlock: txb,
        options: {
            showObjectChanges: true,
            showEvents: true,
        }
    });

    console.log('✅ Outbound order created!');
    console.log('Transaction:', orderResult.digest);

    // Extract order ID from events
    const orderCreatedEvent = orderResult.events?.find(
        e => e.type.includes('OrderCreated')
    );
    
    if (!orderCreatedEvent) {
        throw new Error('OrderCreated event not found');
    }

    const orderId = (orderCreatedEvent.parsedJson as any).order_id;
    console.log('Order ID:', orderId);

    // Step 2: Resolver accepts order and creates HTLC on Sui
    console.log('\n🤝 Step 2: Resolver accepting order and creating HTLC...');
    
    // For demo, we'll act as the resolver
    const acceptTxb = new TransactionBlock();
    
    // Split coin for payment
    const [paymentCoin] = acceptTxb.splitCoins(
        acceptTxb.gas,
        [acceptTxb.pure(TEST_CONFIG.testAmount.sui)]
    );
    
    acceptTxb.moveCall({
        target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::accept_order`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            acceptTxb.object(TEST_CONFIG.sui.swapRegistry),
            acceptTxb.pure(orderId),
            paymentCoin,
            acceptTxb.object('0x6'), // Clock
        ],
    });

    const acceptResult = await suiClient.signAndExecuteTransactionBlock({
        signer: suiKeypair,
        transactionBlock: acceptTxb,
        options: {
            showObjectChanges: true,
            showEvents: true,
        }
    });

    console.log('✅ Order accepted, HTLC created on Sui!');
    console.log('Transaction:', acceptResult.digest);

    // Get HTLC ID from events
    const htlcCreatedEvent = acceptResult.events?.find(
        e => e.type.includes('HTLCCreated')
    );
    
    const htlcId = (htlcCreatedEvent?.parsedJson as any)?.htlc_id;
    console.log('HTLC ID:', htlcId);

    // Step 3: Create corresponding HTLC on Sepolia
    console.log('\n🔗 Step 3: Creating HTLC on Ethereum Sepolia...');
    
    // Note: This requires the actual EscrowFactory address on Sepolia
    if (TEST_CONFIG.sepolia.escrowFactory === '0x1234567890123456789012345678901234567890') {
        console.log('⚠️  Warning: Using placeholder EscrowFactory address');
        console.log('Please deploy the EVM contracts and update the address in test-config.ts');
        console.log('\nSimulating EVM HTLC creation...');
        
        // Simulate the transaction that would happen
        console.log('Would call EscrowFactory.createEscrow with:');
        console.log('- Source Chain:', TEST_CONFIG.sui.network);
        console.log('- Destination:', ethAddress);
        console.log('- Amount:', ethers.formatEther(TEST_CONFIG.testAmount.eth), 'ETH');
        console.log('- Hashlock:', hashlock);
        console.log('- Timelock:', timelock);
    } else {
        // Create actual HTLC on Sepolia
        const factory = new ethers.Contract(
            TEST_CONFIG.sepolia.escrowFactory,
            EscrowFactoryABI.abi,
            ethWallet
        );

        const tx = await factory.createEscrow(
            101, // Sui chain ID (custom)
            ethAddress,
            ethers.parseEther('0.001'), // Safety deposit
            ethers.parseEther('0.001'), // Safety deposit
            TEST_CONFIG.sepolia.chainId,
            hashlock,
            Math.floor(timelock / 1000), // Convert to seconds
            ethers.ZeroAddress, // ETH (native token)
            TEST_CONFIG.testAmount.eth,
            { value: ethers.parseEther('0.102') } // Amount + deposits
        );

        console.log('Transaction sent:', tx.hash);
        const receipt = await tx.wait();
        console.log('✅ HTLC created on Sepolia!');
        
        // Get escrow address from event
        const escrowAddress = receipt.logs[0].address;
        console.log('Escrow Address:', escrowAddress);
    }

    // Step 4: User reveals secret on Sepolia to claim funds
    console.log('\n🔓 Step 4: Revealing secret on Sepolia...');
    console.log('(In production, user would call withdraw() with secret:', secret, ')');

    // Step 5: Resolver uses revealed secret to claim on Sui
    console.log('\n💰 Step 5: Resolver claiming funds on Sui with revealed secret...');
    
    const withdrawTxb = new TransactionBlock();
    
    withdrawTxb.moveCall({
        target: `${TEST_CONFIG.sui.packageId}::fusion_htlc_v2::withdraw`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            withdrawTxb.object(htlcId),
            withdrawTxb.pure(secretBytes, 'vector<u8>'),
            withdrawTxb.object('0x6'), // Clock
        ],
    });

    const withdrawResult = await suiClient.signAndExecuteTransactionBlock({
        signer: suiKeypair,
        transactionBlock: withdrawTxb,
        options: {
            showObjectChanges: true,
            showEvents: true,
        }
    });

    console.log('✅ Funds withdrawn on Sui!');
    console.log('Transaction:', withdrawResult.digest);

    // Step 6: Complete the order
    console.log('\n✔️ Step 6: Marking order as completed...');
    
    const completeTxb = new TransactionBlock();
    
    completeTxb.moveCall({
        target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::complete_order`,
        arguments: [
            completeTxb.object(TEST_CONFIG.sui.swapRegistry),
            completeTxb.pure(orderId),
            completeTxb.pure(secretBytes, 'vector<u8>'),
            completeTxb.object('0x6'), // Clock
        ],
    });

    const completeResult = await suiClient.signAndExecuteTransactionBlock({
        signer: suiKeypair,
        transactionBlock: completeTxb,
        options: {
            showEvents: true,
        }
    });

    console.log('✅ Order marked as completed!');
    console.log('Transaction:', completeResult.digest);

    console.log('\n🎉 Sui → Sepolia cross-chain swap test completed successfully!');
}

// Run the test
testSuiToSepolia()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
    });