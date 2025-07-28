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
import EscrowABI from './contracts/Escrow.json';

async function testSepoliaToSui() {
    console.log('🔄 Testing Ethereum Sepolia → Sui Cross-Chain Swap\n');

    // Initialize clients
    const suiClient = new SuiClient({ url: TEST_CONFIG.sui.rpcUrl });
    const suiKeypair = getSuiKeypair();
    const suiAddress = suiKeypair.getPublicKey().toSuiAddress();
    
    const ethWallet = getEthereumWallet();
    const ethAddress = ethWallet ? await ethWallet.getAddress() : ethers.Wallet.createRandom().address;

    console.log('📍 Ethereum Address:', ethAddress);
    console.log('📍 Sui Address:', suiAddress);

    // Check balances
    const ethBalance = ethWallet ? await ethWallet.provider!.getBalance(ethAddress) : BigInt(0);
    if (ethWallet) {
        console.log('💰 Sepolia Balance:', ethers.formatEther(ethBalance), 'ETH');
    } else {
        console.log('💰 Sepolia Balance: (Simulation mode - no wallet connected)');
    }
    
    const suiBalance = await suiClient.getBalance({ owner: suiAddress });
    console.log('💰 Sui Balance:', Number(suiBalance.totalBalance) / 1e9, 'SUI');

    // Generate secret and hash
    const { secret, secretBytes, hashlock, hashlockBytes } = generateSecretAndHash();
    const timelock = calculateTimelock();
    
    console.log('\n🔐 Swap Parameters:');
    console.log('Secret:', secret);
    console.log('Hashlock:', hashlock);
    console.log('Timelock:', new Date(timelock).toISOString());

    // Step 1: Create HTLC on Sepolia
    console.log('\n🔒 Step 1: Creating HTLC on Ethereum Sepolia...');
    
    let escrowAddress: string;
    let evmTxHash: string;
    
    if (TEST_CONFIG.sepolia.escrowFactory === '0x1234567890123456789012345678901234567890') {
        console.log('⚠️  Warning: Using placeholder EscrowFactory address');
        console.log('Simulating EVM HTLC creation...');
        
        // Simulate transaction
        evmTxHash = '0x' + '0'.repeat(64); // Placeholder
        escrowAddress = ethers.Wallet.createRandom().address;
        
        console.log('Simulated Transaction Hash:', evmTxHash);
        console.log('Simulated Escrow Address:', escrowAddress);
    } else if (ethWallet) {
        // Create actual HTLC on Sepolia
        const factory = new ethers.Contract(
            TEST_CONFIG.sepolia.escrowFactory,
            EscrowFactoryABI.abi,
            ethWallet
        );

        const tx = await factory.createEscrow(
            TEST_CONFIG.sepolia.chainId, // Source chain
            suiAddress, // Destination on Sui
            ethers.parseEther('0.001'), // Safety deposit
            ethers.parseEther('0.001'), // Safety deposit
            101, // Sui chain ID (custom)
            hashlock,
            Math.floor(timelock / 1000), // Convert to seconds
            ethers.ZeroAddress, // ETH (native token)
            TEST_CONFIG.testAmount.eth,
            { value: ethers.parseEther('0.102') } // Amount + deposits
        );

        console.log('Transaction sent:', tx.hash);
        evmTxHash = tx.hash;
        
        const receipt = await tx.wait();
        console.log('✅ HTLC created on Sepolia!');
        
        // Get escrow address from event
        escrowAddress = receipt.logs[0].address;
        console.log('Escrow Address:', escrowAddress);
    } else {
        // No wallet but real factory address
        console.log('⚠️  Cannot create HTLC: No Ethereum wallet configured');
        console.log('Simulating EVM HTLC creation...');
        evmTxHash = '0x' + '0'.repeat(64);
        escrowAddress = ethers.Wallet.createRandom().address;
    }

    // Step 2: Create inbound order on Sui
    console.log('\n📥 Step 2: Creating inbound order on Sui...');
    
    const txb = new TransactionBlock();
    
    // For inbound orders, we'll use a placeholder Sui address for the EVM sender
    // In production, this would be a dedicated resolver address
    const resolverAddress = suiAddress; // Using same address for demo
    
    // EVM tx hash as string
    const evmTxHashStr = evmTxHash;
    
    txb.moveCall({
        target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::create_inbound_order`,
        arguments: [
            txb.object(TEST_CONFIG.sui.swapRegistry),
            txb.pure(TEST_CONFIG.sepolia.chainId, 'u64'),
            txb.pure(resolverAddress, 'address'), // Resolver address on Sui
            txb.pure(suiAddress, 'address'), // Receiver on Sui
            txb.pure(TEST_CONFIG.testAmount.sui, 'u64'),
            txb.pure(hashlockBytes, 'vector<u8>'),
            txb.pure(timelock, 'u64'),
            txb.pure(evmTxHashStr, 'string'), // EVM tx hash as string
            txb.object('0x6'), // Clock
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

    console.log('✅ Inbound order created!');
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

    // Step 3: Resolver accepts order and creates HTLC on Sui
    console.log('\n🤝 Step 3: Resolver accepting order and creating HTLC on Sui...');
    
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

    // Get HTLC ID
    const htlcCreatedEvent = acceptResult.events?.find(
        e => e.type.includes('HTLCCreated')
    );
    
    const htlcId = (htlcCreatedEvent?.parsedJson as any)?.htlc_id;
    console.log('HTLC ID:', htlcId);

    // Wait a moment for the object to be available
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 4: User reveals secret on Sui to claim funds
    console.log('\n🔓 Step 4: User claiming funds on Sui with secret...');
    
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
    
    // Transfer the withdrawn coin to receiver
    withdrawTxb.transferObjects([withdrawnCoin], withdrawTxb.pure(suiAddress));

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
    
    // Extract revealed secret from event
    const withdrawnEvent = withdrawResult.events?.find(
        e => e.type.includes('HTLCWithdrawn')
    );
    
    if (withdrawnEvent) {
        console.log('Secret revealed on-chain!');
    }

    // Step 5: Resolver uses revealed secret to claim on Sepolia
    console.log('\n💰 Step 5: Resolver claiming funds on Sepolia...');
    
    if (TEST_CONFIG.sepolia.escrowFactory === '0x1234567890123456789012345678901234567890') {
        console.log('Simulating withdrawal on Sepolia with secret:', secret);
        console.log('Would call Escrow.withdraw(secret) on address:', escrowAddress);
    } else if (ethWallet) {
        // Withdraw from escrow on Sepolia
        const escrow = new ethers.Contract(
            escrowAddress,
            EscrowABI.abi,
            ethWallet
        );

        const withdrawTx = await escrow.withdraw(secret);
        console.log('Transaction sent:', withdrawTx.hash);
        
        await withdrawTx.wait();
        console.log('✅ Funds withdrawn on Sepolia!');
    } else {
        console.log('⚠️  Cannot withdraw from Sepolia: No Ethereum wallet configured');
        console.log('Would call Escrow.withdraw(secret) on address:', escrowAddress);
    }

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

    console.log('\n🎉 Sepolia → Sui cross-chain swap test completed successfully!');
}

// Run the test
testSepoliaToSui()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
    });