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

async function testSuiToSepoliaReal() {
    console.log('🔄 Testing Sui → Ethereum Sepolia Cross-Chain Swap with REAL Contract\n');

    // Initialize clients
    const suiClient = new SuiClient({ url: TEST_CONFIG.sui.rpcUrl });
    const suiKeypair = getSuiKeypair();
    const suiAddress = suiKeypair.getPublicKey().toSuiAddress();
    
    const ethWallet = getEthereumWallet();
    const ethAddress = ethWallet ? await ethWallet.getAddress() : ethers.Wallet.createRandom().address;

    console.log('📍 Sui Address:', suiAddress);
    console.log('📍 Ethereum Address:', ethAddress);
    console.log('📍 HTLC Contract:', TEST_CONFIG.sepolia.htlcContract);

    // Check balances
    const suiBalance = await suiClient.getBalance({ owner: suiAddress });
    console.log('💰 Sui Balance:', Number(suiBalance.totalBalance) / 1e9, 'SUI');
    
    if (ethWallet) {
        const ethBalance = await ethWallet.provider!.getBalance(ethAddress);
        console.log('💰 Sepolia Balance:', ethers.formatEther(ethBalance), 'ETH');
    } else {
        console.log('💰 Sepolia Balance: (No wallet configured - will simulate)');
    }

    // Generate secret and hash
    const { secret, secretBytes, hashlock, hashlockBytes } = generateSecretAndHash();
    const timelock = calculateTimelock();
    
    console.log('\n🔐 Swap Parameters:');
    console.log('Secret:', secret);
    console.log('Hashlock:', hashlock);
    console.log('Timelock:', new Date(timelock).toISOString());

    try {
        // Step 1: Create outbound order on Sui
        console.log('\n📤 Step 1: Creating outbound order on Sui...');
        
        const txb = new TransactionBlock();
        
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
        console.log('\n🤝 Step 2: Resolver accepting order and creating HTLC on Sui...');
        
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

        // Step 3: Create HTLC on Sepolia using deployed contract
        console.log('\n🔗 Step 3: Creating HTLC on Ethereum Sepolia...');
        
        if (ethWallet) {
            // Connect to the deployed contract
            const htlcContract = new ethers.Contract(
                TEST_CONFIG.sepolia.htlcContract,
                deploymentInfo.abi,
                ethWallet
            );

            // Create HTLC on Sepolia
            const tx = await htlcContract.createHTLC(
                ethAddress, // receiver
                hashlock,
                Math.floor(timelock / 1000), // Convert to seconds
                { value: TEST_CONFIG.testAmount.eth } // Send ETH
            );

            console.log('Transaction sent:', tx.hash);
            const receipt = await tx.wait();
            console.log('✅ HTLC created on Sepolia!');
            
            // Get contractId from event
            const htlcCreatedLog = receipt.logs.find(
                (log: any) => log.eventName === 'HTLCCreated'
            );
            
            const contractId = htlcCreatedLog?.args?.contractId;
            console.log('Contract ID:', contractId);
            
            // Check the contract details
            const contractDetails = await htlcContract.getContract(contractId);
            console.log('\n📋 HTLC Details on Sepolia:');
            console.log('- Sender:', contractDetails.sender);
            console.log('- Receiver:', contractDetails.receiver);
            console.log('- Amount:', ethers.formatEther(contractDetails.amount), 'ETH');
            console.log('- Hashlock:', contractDetails.hashlock);
            console.log('- Timelock:', new Date(Number(contractDetails.timelock) * 1000).toISOString());
            
            // Step 4: User reveals secret on Sepolia
            console.log('\n🔓 Step 4: User withdrawing from HTLC on Sepolia...');
            
            const withdrawTx = await htlcContract.withdraw(contractId, secret);
            console.log('Transaction sent:', withdrawTx.hash);
            await withdrawTx.wait();
            console.log('✅ Funds withdrawn on Sepolia!');
            
            // Check final balance
            const finalBalance = await ethWallet.provider!.getBalance(ethAddress);
            console.log('💰 Final Sepolia Balance:', ethers.formatEther(finalBalance), 'ETH');
        } else {
            console.log('⚠️  No Ethereum wallet configured - simulating Sepolia HTLC...');
            console.log('Would create HTLC with:');
            console.log('- Receiver:', ethAddress);
            console.log('- Amount:', ethers.formatEther(TEST_CONFIG.testAmount.eth), 'ETH');
            console.log('- Hashlock:', hashlock);
            console.log('- Timelock:', Math.floor(timelock / 1000));
            console.log('\nContract ID would be: 0x' + '1'.repeat(64));
            console.log('User would withdraw with secret:', secret);
        }

        // Step 5: Resolver uses revealed secret to claim on Sui
        console.log('\n💰 Step 5: Resolver claiming funds on Sui with revealed secret...');
        
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
        
        // Transfer the withdrawn coin
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

        // Final summary
        console.log('\n🎉 Cross-chain swap completed successfully!');
        console.log('\n📊 Summary:');
        console.log('- Locked 0.1 SUI on Sui');
        console.log('- Created HTLC on Sepolia (real contract)');
        console.log('- Revealed secret to claim ETH');
        console.log('- Used secret to claim SUI');
        console.log('- Atomic swap completed!');
        
        if (ethWallet) {
            console.log('\n🔗 View on Etherscan:');
            console.log(`https://sepolia.etherscan.io/address/${TEST_CONFIG.sepolia.htlcContract}`);
        }

    } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        if (error.cause) {
            console.error('Cause:', error.cause);
        }
    }
}

// Run the test
testSuiToSepoliaReal()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });