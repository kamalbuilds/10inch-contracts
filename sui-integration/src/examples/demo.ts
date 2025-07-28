// Copyright (c) 1inch Network
// SPDX-License-Identifier: MIT

/**
 * Sui Atomic Swap SDK Demo
 * 
 * This demo showcases the main features of the Sui Atomic Swap SDK:
 * 1. Creating and completing atomic swaps
 * 2. Creating and managing cross-chain bridge orders
 * 3. Querying swap and bridge states
 */

import { SuiAtomicSwap, SUI_NETWORKS, SUPPORTED_CHAINS, Utils } from '../index';

// Demo configuration
const DEMO_CONFIG = {
    network: SUI_NETWORKS.devnet,
    // These would be real deployed contract addresses
    packageId: '0x1234567890abcdef1234567890abcdef12345678',
    swapEscrowId: '0xabcdef1234567890abcdef1234567890abcdef12',
    bridgeId: '0xfedcba0987654321fedcba0987654321fedcba09',
};

async function runAtomicSwapDemo() {
    console.log('🔄 Running Sui Atomic Swap Demo...\n');

    try {
        // Create test accounts
        console.log('📝 Creating test accounts...');
        const alice = await Utils.createTestAccount('devnet');
        const bob = await Utils.createTestAccount('devnet');
        
        console.log(`👤 Alice: ${alice.address}`);
        console.log(`👤 Bob: ${bob.address}\n`);

        // Initialize SDK for Alice
        const aliceSDK = new SuiAtomicSwap({
            ...DEMO_CONFIG,
            keyPair: alice.keypair,
        });

        // Initialize SDK for Bob
        const bobSDK = new SuiAtomicSwap({
            ...DEMO_CONFIG,
            keyPair: bob.keypair,
        });

        // Check initial balances
        console.log('💰 Checking initial balances...');
        const aliceBalance = await aliceSDK.getBalance();
        const bobBalance = await bobSDK.getBalance();
        console.log(`Alice balance: ${aliceBalance} MIST`);
        console.log(`Bob balance: ${bobBalance} MIST\n`);

        // Generate secret and hashlock for the swap
        const secret = Utils.generateSecret();
        const hashlock = Utils.generateHashlock(secret);
        const timelock = Utils.calculateTimelock(60); // 60 minutes
        const swapAmount = '1000000000'; // 1 SUI in MIST

        console.log('🔐 Swap parameters:');
        console.log(`Secret: ${secret}`);
        console.log(`Hashlock: ${hashlock}`);
        console.log(`Timelock: ${timelock}`);
        console.log(`Amount: ${swapAmount} MIST\n`);

        // Step 1: Alice creates a swap
        console.log('🚀 Step 1: Alice creates atomic swap...');
        const swapResult = await aliceSDK.createSwap({
            amount: swapAmount,
            hashlock,
            timelock,
            receiver: bob.address,
        });

        console.log(`✅ Swap created successfully!`);
        console.log(`Swap ID: ${swapResult.swapId}`);
        console.log(`Transaction: ${swapResult.transactionDigest}`);
        console.log(`Gas used: ${swapResult.gasUsed}\n`);

        // Step 2: Check swap state
        console.log('🔍 Step 2: Checking swap state...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for finality

        const swapState = await aliceSDK.getSwap(swapResult.swapId);
        if (swapState) {
            console.log('📊 Swap State:');
            console.log(`State: ${swapState.state}`);
            console.log(`Sender: ${swapState.sender}`);
            console.log(`Receiver: ${swapState.receiver}`);
            console.log(`Amount: ${swapState.amount} MIST`);
            console.log(`Created at: ${new Date(parseInt(swapState.created_at))}\n`);
        }

        // Step 3: Bob completes the swap
        console.log('🎯 Step 3: Bob completes the swap...');
        const completeResult = await bobSDK.completeSwap({
            swapObjectId: swapResult.swapId,
            secret,
        });

        console.log(`✅ Swap completed successfully!`);
        console.log(`Secret revealed: ${completeResult.secret}`);
        console.log(`Transaction: ${completeResult.transactionDigest}`);
        console.log(`Amount received: ${completeResult.amount} MIST\n`);

        // Check final balances
        console.log('💰 Checking final balances...');
        const aliceFinalBalance = await aliceSDK.getBalance();
        const bobFinalBalance = await bobSDK.getBalance();
        console.log(`Alice balance: ${aliceFinalBalance} MIST`);
        console.log(`Bob balance: ${bobFinalBalance} MIST\n`);

        // Get protocol statistics
        console.log('📈 Protocol Statistics:');
        const protocolStats = await aliceSDK.getProtocolStats();
        console.log(`Total swaps: ${protocolStats.swap_count}`);
        console.log(`Total volume: ${protocolStats.total_volume} MIST`);
        console.log(`Fees collected: ${protocolStats.protocol_fees_collected} MIST`);
        console.log(`Fee rate: ${protocolStats.fee_rate} basis points`);
        console.log(`Is paused: ${protocolStats.is_paused}\n`);

    } catch (error) {
        console.error('❌ Atomic swap demo failed:', error);
    }
}

async function runCrossChainBridgeDemo() {
    console.log('🌉 Running Cross-Chain Bridge Demo...\n');

    try {
        // Create test accounts
        console.log('📝 Creating test accounts...');
        const sender = await Utils.createTestAccount('devnet');
        const recipient = await Utils.createTestAccount('devnet');
        
        console.log(`👤 Sender: ${sender.address}`);
        console.log(`👤 Recipient: ${recipient.address}\n`);

        // Initialize SDK for sender
        const senderSDK = new SuiAtomicSwap({
            ...DEMO_CONFIG,
            keyPair: sender.keypair,
        });

        // Initialize SDK for recipient
        const recipientSDK = new SuiAtomicSwap({
            ...DEMO_CONFIG,
            keyPair: recipient.keypair,
        });

        // Generate bridge order parameters
        const secret = Utils.generateSecret();
        const hashlock = Utils.generateHashlock(secret);
        const timelock = Utils.calculateTimelock(120); // 2 hours
        const bridgeAmount = '2000000000'; // 2 SUI in MIST

        console.log('🔐 Bridge order parameters:');
        console.log(`Secret: ${secret}`);
        console.log(`Hashlock: ${hashlock}`);
        console.log(`Timelock: ${timelock}`);
        console.log(`Amount: ${bridgeAmount} MIST`);
        console.log(`Destination: Ethereum (${SUPPORTED_CHAINS.ETHEREUM})\n`);

        // Step 1: Create outbound bridge order (Sui -> Ethereum)
        console.log('🚀 Step 1: Creating outbound bridge order...');
        const bridgeResult = await senderSDK.createOutboundOrder({
            amount: bridgeAmount,
            destinationChain: SUPPORTED_CHAINS.ETHEREUM,
            recipient: recipient.address,
            hashlock,
            timelock,
        });

        console.log(`✅ Bridge order created successfully!`);
        console.log(`Order ID: ${bridgeResult.orderId}`);
        console.log(`Transaction: ${bridgeResult.transactionDigest}`);
        console.log(`Gas used: ${bridgeResult.gasUsed}\n`);

        // Step 2: Check bridge order state
        console.log('🔍 Step 2: Checking bridge order state...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for finality

        const bridgeOrder = await senderSDK.getBridgeOrder(bridgeResult.orderId);
        if (bridgeOrder) {
            console.log('📊 Bridge Order State:');
            console.log(`Order Type: ${bridgeOrder.order_type === 0 ? 'Outbound' : 'Inbound'}`);
            console.log(`Source Chain: ${bridgeOrder.source_chain}`);
            console.log(`Destination Chain: ${bridgeOrder.destination_chain}`);
            console.log(`Source Amount: ${bridgeOrder.source_amount} MIST`);
            console.log(`Destination Amount: ${bridgeOrder.destination_amount} MIST`);
            console.log(`Bridge Fee: ${bridgeOrder.bridge_fee} MIST`);
            console.log(`State: ${bridgeOrder.state}`);
            console.log(`Created at: ${new Date(parseInt(bridgeOrder.created_at))}\n`);
        }

        // Step 3: Simulate completion of bridge order
        console.log('🎯 Step 3: Completing bridge order...');
        const destinationTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
        
        // Note: In a real scenario, this would be called after the funds are received on the destination chain
        const completeResult = await recipientSDK.completeBridgeOrder(
            bridgeResult.orderId,
            secret,
            destinationTxHash
        );

        console.log(`✅ Bridge order completed successfully!`);
        console.log(`Secret revealed: ${completeResult.secret}`);
        console.log(`Transaction: ${completeResult.transactionDigest}`);
        console.log(`Amount received: ${completeResult.amount} MIST\n`);

        // Get bridge statistics
        console.log('📈 Bridge Statistics:');
        const bridgeStats = await senderSDK.getBridgeStats();
        console.log(`Total orders: ${bridgeStats.order_count}`);
        console.log(`Total volume: ${bridgeStats.total_volume} MIST`);
        console.log(`Bridge fees: ${bridgeStats.bridge_fees_collected} MIST`);
        console.log(`Default fee rate: ${bridgeStats.default_fee_rate} basis points`);
        console.log(`Is paused: ${bridgeStats.is_paused}\n`);

        // Check supported chains
        console.log('🔗 Checking supported chains...');
        for (const [chainName, chainId] of Object.entries(SUPPORTED_CHAINS)) {
            const isSupported = await senderSDK.isChainSupported(chainId);
            console.log(`${chainName} (${chainId}): ${isSupported ? '✅' : '❌'}`);
        }
        console.log();

        // Calculate bridge fees for different chains
        console.log('💸 Bridge fee calculations:');
        const testAmount = '1000000000'; // 1 SUI
        
        for (const [chainName, chainId] of Object.entries(SUPPORTED_CHAINS)) {
            if (chainId !== SUPPORTED_CHAINS.SUI) { // Skip native chain
                try {
                    const fee = await senderSDK.calculateBridgeFee(testAmount, chainId);
                    console.log(`${chainName}: ${fee} MIST (${(parseFloat(fee) / parseFloat(testAmount) * 100).toFixed(3)}%)`);
                } catch (error) {
                    console.log(`${chainName}: Error calculating fee`);
                }
            }
        }
        console.log();

    } catch (error) {
        console.error('❌ Cross-chain bridge demo failed:', error);
    }
}

async function runQueryDemo() {
    console.log('🔍 Running Query Demo...\n');

    try {
        // Create a test account
        const testAccount = await Utils.createTestAccount('devnet');
        console.log(`👤 Test Account: ${testAccount.address}\n`);

        // Initialize SDK
        const sdk = new SuiAtomicSwap({
            ...DEMO_CONFIG,
            keyPair: testAccount.keypair,
        });

        // Get account balances
        console.log('💰 Account balances:');
        const balances = await sdk.getAllBalances();
        balances.forEach(balance => {
            console.log(`${balance.coinType}: ${balance.balance}`);
        });
        console.log();

        // Test utility functions
        console.log('🛠️  Testing utility functions:');
        const secret = Utils.generateSecret();
        const hashlock = Utils.generateHashlock(secret);
        const isValid = Utils.verifySecret(secret, hashlock);
        const timestamp = Utils.getCurrentTimestamp();
        const futureTimelock = Utils.calculateTimelock(30);

        console.log(`Generated secret: ${secret}`);
        console.log(`Generated hashlock: ${hashlock}`);
        console.log(`Secret verification: ${isValid ? '✅' : '❌'}`);
        console.log(`Current timestamp: ${timestamp} (${new Date(timestamp)})`);
        console.log(`Future timelock: ${futureTimelock} (${new Date(parseInt(futureTimelock))})\n`);

        // Test invalid secret verification
        const wrongSecret = Utils.generateSecret();
        const wrongVerification = Utils.verifySecret(wrongSecret, hashlock);
        console.log(`Wrong secret verification: ${wrongVerification ? '❌ FAILED' : '✅ PASSED'}\n`);

    } catch (error) {
        console.error('❌ Query demo failed:', error);
    }
}

async function main() {
    console.log('🎉 Welcome to the Sui Atomic Swap SDK Demo!\n');
    console.log('This demo will showcase the following features:');
    console.log('1. Atomic swaps on Sui');
    console.log('2. Cross-chain bridge orders');
    console.log('3. Querying and utility functions\n');
    console.log('⚠️  Note: This demo uses placeholder contract addresses.');
    console.log('   In a real implementation, these would be actual deployed contracts.\n');

    // Run demos
    await runAtomicSwapDemo();
    await runCrossChainBridgeDemo();
    await runQueryDemo();

    console.log('🎊 Demo completed! Thanks for trying the Sui Atomic Swap SDK!');
}

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

// Run the demo if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

export { runAtomicSwapDemo, runCrossChainBridgeDemo, runQueryDemo, main }; 