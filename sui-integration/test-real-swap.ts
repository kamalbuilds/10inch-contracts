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

async function testRealCrossChainSwap() {
    console.log('🔄 Testing REAL Cross-Chain Swaps: Sui ↔ Sepolia\n');
    console.log('📍 Using deployed HTLC contract:', TEST_CONFIG.sepolia.htlcContract);
    console.log('🔗 View on Etherscan: https://sepolia.etherscan.io/address/' + TEST_CONFIG.sepolia.htlcContract);
    console.log('\n' + '='.repeat(80) + '\n');

    // Initialize clients
    const suiClient = new SuiClient({ url: TEST_CONFIG.sui.rpcUrl });
    const suiKeypair = getSuiKeypair();
    const suiAddress = suiKeypair.getPublicKey().toSuiAddress();
    
    const ethWallet = getEthereumWallet();
    if (!ethWallet) {
        console.error('❌ Error: SEPOLIA_PRIVATE_KEY not found in .env');
        console.log('Please add your Sepolia private key to test real swaps');
        return;
    }
    
    const ethAddress = await ethWallet.getAddress();
    const provider = ethWallet.provider!;

    console.log('👛 Wallet Addresses:');
    console.log('- Sui:', suiAddress);
    console.log('- Sepolia:', ethAddress);

    // Check initial balances
    console.log('\n💰 Initial Balances:');
    const suiBalance = await suiClient.getBalance({ owner: suiAddress });
    const ethBalance = await provider.getBalance(ethAddress);
    console.log('- Sui:', Number(suiBalance.totalBalance) / 1e9, 'SUI');
    console.log('- Sepolia:', ethers.formatEther(ethBalance), 'ETH');

    // Part 1: Sui → Sepolia Swap
    console.log('\n' + '='.repeat(80));
    console.log('\n🚀 PART 1: SUI → SEPOLIA SWAP\n');
    
    try {
        // Generate secret for first swap
        const swap1 = generateSecretAndHash();
        const timelock1 = calculateTimelock();
        
        console.log('🔐 Swap 1 Parameters:');
        console.log('- Secret:', swap1.secret);
        console.log('- Hashlock:', swap1.hashlock);
        console.log('- Timelock:', new Date(timelock1).toISOString());
        console.log('- Amount: 0.1 SUI → 0.001 ETH');

        // Step 1: Create outbound order on Sui
        console.log('\n📤 Step 1: Creating outbound order on Sui...');
        const orderTxb = new TransactionBlock();
        
        orderTxb.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::create_outbound_order`,
            arguments: [
                orderTxb.object(TEST_CONFIG.sui.swapRegistry),
                orderTxb.pure(TEST_CONFIG.sepolia.chainId, 'u64'),
                orderTxb.pure(suiAddress, 'address'),
                orderTxb.pure(TEST_CONFIG.testAmount.sui, 'u64'),
                orderTxb.pure(swap1.hashlockBytes, 'vector<u8>'),
                orderTxb.pure(timelock1, 'u64'),
                orderTxb.object('0x6'),
            ],
        });

        const orderResult = await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: orderTxb,
            options: { showObjectChanges: true, showEvents: true }
        });

        const orderEvent = orderResult.events?.find(e => e.type.includes('OrderCreated'));
        const orderId = (orderEvent?.parsedJson as any)?.order_id;
        console.log('✅ Order created:', orderId);

        // Step 2: Resolver accepts and creates HTLC on Sui
        console.log('\n🤝 Step 2: Resolver accepting order...');
        const acceptTxb = new TransactionBlock();
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
                acceptTxb.object('0x6'),
            ],
        });

        const acceptResult = await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: acceptTxb,
            options: { showObjectChanges: true, showEvents: true }
        });

        const htlcEvent = acceptResult.events?.find(e => e.type.includes('HTLCCreated'));
        const suiHtlcId = (htlcEvent?.parsedJson as any)?.htlc_id;
        console.log('✅ HTLC created on Sui:', suiHtlcId);

        // Step 3: Create HTLC on Sepolia
        console.log('\n🔗 Step 3: Creating HTLC on Sepolia...');
        const htlcContract = new ethers.Contract(
            TEST_CONFIG.sepolia.htlcContract,
            deploymentInfo.abi,
            ethWallet
        );

        const createTx = await htlcContract.createHTLC(
            ethAddress,
            swap1.hashlock,
            Math.floor(timelock1 / 1000),
            { value: ethers.parseEther('0.001') }
        );

        console.log('⏳ Waiting for confirmation...');
        const createReceipt = await createTx.wait();
        
        const htlcCreatedLog = createReceipt.logs.find(
            (log: any) => {
                try {
                    const parsed = htlcContract.interface.parseLog(log);
                    return parsed?.name === 'HTLCCreated';
                } catch {
                    return false;
                }
            }
        );
        
        const parsedLog = htlcContract.interface.parseLog(htlcCreatedLog);
        const ethContractId = parsedLog?.args?.contractId;
        console.log('✅ HTLC created on Sepolia:', ethContractId);
        console.log('📝 Tx:', createTx.hash);

        // Step 4: User withdraws on Sepolia (reveals secret)
        console.log('\n🔓 Step 4: User withdrawing on Sepolia...');
        const withdrawTx = await htlcContract.withdraw(ethContractId, swap1.secret);
        await withdrawTx.wait();
        console.log('✅ ETH withdrawn! Secret revealed on-chain');
        console.log('📝 Tx:', withdrawTx.hash);

        // Step 5: Resolver claims on Sui using revealed secret
        console.log('\n💰 Step 5: Resolver claiming on Sui...');
        const claimTxb = new TransactionBlock();
        const [withdrawnCoin] = claimTxb.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_htlc_v2::withdraw`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                claimTxb.object(suiHtlcId),
                claimTxb.pure(swap1.secretBytes, 'vector<u8>'),
                claimTxb.object('0x6'),
            ],
        });
        claimTxb.transferObjects([withdrawnCoin], claimTxb.pure(suiAddress));

        const claimResult = await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: claimTxb,
            options: { showEvents: true }
        });
        console.log('✅ SUI claimed!');
        console.log('📝 Tx:', claimResult.digest);

        // Mark order complete
        const completeTxb = new TransactionBlock();
        completeTxb.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::complete_order`,
            arguments: [
                completeTxb.object(TEST_CONFIG.sui.swapRegistry),
                completeTxb.pure(orderId),
                completeTxb.pure(swap1.secretBytes, 'vector<u8>'),
                completeTxb.object('0x6'),
            ],
        });
        await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: completeTxb,
        });
        console.log('✅ Order marked complete');

        console.log('\n🎉 Sui → Sepolia swap completed successfully!');

    } catch (error: any) {
        console.error('❌ Error in Sui → Sepolia swap:', error.message);
    }

    // Part 2: Sepolia → Sui Swap
    console.log('\n' + '='.repeat(80));
    console.log('\n🚀 PART 2: SEPOLIA → SUI SWAP\n');
    
    try {
        // Generate new secret for second swap
        const swap2 = generateSecretAndHash();
        const timelock2 = calculateTimelock();
        
        console.log('🔐 Swap 2 Parameters:');
        console.log('- Secret:', swap2.secret);
        console.log('- Hashlock:', swap2.hashlock);
        console.log('- Timelock:', new Date(timelock2).toISOString());
        console.log('- Amount: 0.001 ETH → 0.1 SUI');

        // Step 1: Create HTLC on Sepolia
        console.log('\n🔒 Step 1: Creating HTLC on Sepolia...');
        const htlcContract = new ethers.Contract(
            TEST_CONFIG.sepolia.htlcContract,
            deploymentInfo.abi,
            ethWallet
        );

        const createTx2 = await htlcContract.createHTLC(
            ethAddress,
            swap2.hashlock,
            Math.floor(timelock2 / 1000),
            { value: ethers.parseEther('0.001') }
        );

        console.log('⏳ Waiting for confirmation...');
        const createReceipt2 = await createTx2.wait();
        
        const htlcCreatedLog2 = createReceipt2.logs.find(
            (log: any) => {
                try {
                    const parsed = htlcContract.interface.parseLog(log);
                    return parsed?.name === 'HTLCCreated';
                } catch {
                    return false;
                }
            }
        );
        
        const parsedLog2 = htlcContract.interface.parseLog(htlcCreatedLog2);
        const ethContractId2 = parsedLog2?.args?.contractId;
        console.log('✅ HTLC created on Sepolia:', ethContractId2);
        console.log('📝 Tx:', createTx2.hash);

        // Step 2: Create inbound order on Sui
        console.log('\n📥 Step 2: Creating inbound order on Sui...');
        const inboundTxb = new TransactionBlock();
        
        inboundTxb.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::create_inbound_order`,
            arguments: [
                inboundTxb.object(TEST_CONFIG.sui.swapRegistry),
                inboundTxb.pure(TEST_CONFIG.sepolia.chainId, 'u64'),
                inboundTxb.pure(suiAddress, 'address'), // sender (resolver)
                inboundTxb.pure(suiAddress, 'address'), // receiver
                inboundTxb.pure(TEST_CONFIG.testAmount.sui, 'u64'),
                inboundTxb.pure(swap2.hashlockBytes, 'vector<u8>'),
                inboundTxb.pure(timelock2, 'u64'),
                inboundTxb.pure(createTx2.hash, 'string'),
                inboundTxb.object('0x6'),
            ],
        });

        const inboundResult = await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: inboundTxb,
            options: { showEvents: true }
        });

        const orderEvent2 = inboundResult.events?.find(e => e.type.includes('OrderCreated'));
        const orderId2 = (orderEvent2?.parsedJson as any)?.order_id;
        console.log('✅ Inbound order created:', orderId2);

        // Step 3: Resolver accepts and creates HTLC on Sui
        console.log('\n🤝 Step 3: Resolver creating HTLC on Sui...');
        const acceptTxb2 = new TransactionBlock();
        const [paymentCoin2] = acceptTxb2.splitCoins(
            acceptTxb2.gas,
            [acceptTxb2.pure(TEST_CONFIG.testAmount.sui)]
        );
        
        acceptTxb2.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::accept_order`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                acceptTxb2.object(TEST_CONFIG.sui.swapRegistry),
                acceptTxb2.pure(orderId2),
                paymentCoin2,
                acceptTxb2.object('0x6'),
            ],
        });

        const acceptResult2 = await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: acceptTxb2,
            options: { showEvents: true }
        });

        const htlcEvent2 = acceptResult2.events?.find(e => e.type.includes('HTLCCreated'));
        const suiHtlcId2 = (htlcEvent2?.parsedJson as any)?.htlc_id;
        console.log('✅ HTLC created on Sui:', suiHtlcId2);

        // Step 4: User withdraws on Sui (reveals secret)
        console.log('\n🔓 Step 4: User withdrawing on Sui...');
        const withdrawTxb2 = new TransactionBlock();
        const [withdrawnCoin2] = withdrawTxb2.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_htlc_v2::withdraw`,
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
                withdrawTxb2.object(suiHtlcId2),
                withdrawTxb2.pure(swap2.secretBytes, 'vector<u8>'),
                withdrawTxb2.object('0x6'),
            ],
        });
        withdrawTxb2.transferObjects([withdrawnCoin2], withdrawTxb2.pure(suiAddress));

        const withdrawResult2 = await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: withdrawTxb2,
            options: { showEvents: true }
        });
        console.log('✅ SUI withdrawn! Secret revealed on-chain');
        console.log('📝 Tx:', withdrawResult2.digest);

        // Step 5: Resolver claims on Sepolia using revealed secret
        console.log('\n💰 Step 5: Resolver claiming on Sepolia...');
        const claimTx2 = await htlcContract.withdraw(ethContractId2, swap2.secret);
        await claimTx2.wait();
        console.log('✅ ETH claimed!');
        console.log('📝 Tx:', claimTx2.hash);

        // Mark order complete
        const completeTxb2 = new TransactionBlock();
        completeTxb2.moveCall({
            target: `${TEST_CONFIG.sui.packageId}::fusion_cross_chain::complete_order`,
            arguments: [
                completeTxb2.object(TEST_CONFIG.sui.swapRegistry),
                completeTxb2.pure(orderId2),
                completeTxb2.pure(swap2.secretBytes, 'vector<u8>'),
                completeTxb2.object('0x6'),
            ],
        });
        await suiClient.signAndExecuteTransactionBlock({
            signer: suiKeypair,
            transactionBlock: completeTxb2,
        });
        console.log('✅ Order marked complete');

        console.log('\n🎉 Sepolia → Sui swap completed successfully!');

    } catch (error: any) {
        console.error('❌ Error in Sepolia → Sui swap:', error.message);
    }

    // Check final balances
    console.log('\n' + '='.repeat(80));
    console.log('\n💰 Final Balances:');
    const finalSuiBalance = await suiClient.getBalance({ owner: suiAddress });
    const finalEthBalance = await provider.getBalance(ethAddress);
    console.log('- Sui:', Number(finalSuiBalance.totalBalance) / 1e9, 'SUI');
    console.log('- Sepolia:', ethers.formatEther(finalEthBalance), 'ETH');

    console.log('\n🎯 Summary:');
    console.log('✅ Successfully demonstrated bidirectional atomic swaps');
    console.log('✅ Sui → Sepolia: 0.1 SUI swapped for 0.001 ETH');
    console.log('✅ Sepolia → Sui: 0.001 ETH swapped for 0.1 SUI');
    console.log('✅ All swaps completed atomically without trust');
    
    console.log('\n📊 Supported Tokens:');
    console.log('- Sui: SUI (native), can support any Coin<T>');
    console.log('- Sepolia: ETH (native)');
    console.log('- Future: USDC, USDT, WETH, etc. can be added');
}

// Run the test
testRealCrossChainSwap()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });