import {
    SuiClient,
    TransactionBlock,
    Ed25519Keypair,
    fromB64,
    getFullnodeUrl
} from '@mysten/sui.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Load deployment info
const deployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'deployment.json'), 'utf8')
);
const keys = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'keys.json'), 'utf8')
);

async function demoFusionFlow() {
    console.log('🎯 1inch Fusion+ Demo on Sui\n');

    const client = new SuiClient({ url: getFullnodeUrl('testnet') });

    // Load accounts
    const deployerKey = Ed25519Keypair.fromSecretKey(fromB64(keys.deployer.privateKey));
    const relayerKey = Ed25519Keypair.fromSecretKey(fromB64(keys.relayer.privateKey));

    // Create user accounts
    const aliceKey = new Ed25519Keypair();
    const alice = aliceKey.getPublicKey().toSuiAddress();
    const bob = '0x' + crypto.randomBytes(32).toString('hex'); // Destination address

    console.log('👥 Participants:');
    console.log('Alice (Initiator):', alice);
    console.log('Bob (Dst Recipient):', bob);
    console.log('Relayer:', keys.relayer.address);

    // Fund Alice
    console.log('\n💰 Funding Alice...');
    const fundTx = new TransactionBlock();
    const [coin] = fundTx.splitCoins(fundTx.gas, [fundTx.pure(100_000_000)]); // 0.1 SUI
    fundTx.transferObjects([coin], fundTx.pure(alice));

    await client.signAndExecuteTransactionBlock({
        signer: deployerKey,
        transactionBlock: fundTx,
    });

    // Wait for funding
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 1: Alice creates cross-chain order
    console.log('\n📝 Step 1: Alice creates cross-chain order');
    
    const secret = crypto.randomBytes(32);
    const secretHash = crypto.createHash('sha256').update(secret).digest();
    const timelock = Date.now() + 3600000; // 1 hour in ms
    
    console.log('Secret:', secret.toString('hex'));
    console.log('Secret Hash:', secretHash.toString('hex'));

    // Get current time from blockchain
    const clockId = '0x6'; // Sui system clock

    const createOrderTx = new TransactionBlock();
    
    // Split coins for payment and deposit
    const [payment, deposit] = createOrderTx.splitCoins(
        createOrderTx.gas,
        [
            createOrderTx.pure(10_000_000), // 0.01 SUI payment
            createOrderTx.pure(1_000_000),  // 0.001 SUI deposit
        ]
    );

    createOrderTx.moveCall({
        target: `${deployment.packageId}::fusion_relayer::deploy_source`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            createOrderTx.object(deployment.hubId),
            payment,
            deposit,
            createOrderTx.pure(2), // dst chain (Ethereum)
            createOrderTx.pure(Array.from(Buffer.from(bob.slice(2), 'hex'))),
            createOrderTx.pure('9500000'), // dst amount
            createOrderTx.pure(Array.from(secretHash)),
            createOrderTx.pure(timelock.toString()),
            createOrderTx.object(clockId),
        ],
    });

    const orderResult = await client.signAndExecuteTransactionBlock({
        signer: aliceKey,
        transactionBlock: createOrderTx,
        options: {
            showEvents: true,
            showEffects: true,
        },
    });

    console.log('✅ Order created:', orderResult.digest);

    // Get order ID from events
    const orderCreatedEvent = orderResult.events?.find(
        e => e.type.includes('OrderCreated')
    );
    const orderId = orderCreatedEvent?.parsedJson?.order_id || 1;
    console.log('Order ID:', orderId);

    // Get HTLC object ID (would be from event in real implementation)
    const htlcId = orderResult.objectChanges?.find(
        change => change.type === 'created' && 
        change.objectType?.includes('HTLC')
    )?.objectId!;

    console.log('HTLC ID:', htlcId);

    // Step 2: Relayer deploys on destination chain
    console.log('\n🌉 Step 2: Relayer deploys HTLC on destination chain');
    console.log('(In real scenario, relayer would deploy on Ethereum/Aptos/etc)');
    const dstTxHash = crypto.randomBytes(32);
    console.log('Destination TX:', dstTxHash.toString('hex'));

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 3: Relayer completes order
    console.log('\n💸 Step 3: Relayer completes order and withdraws');

    const completeTx = new TransactionBlock();
    completeTx.moveCall({
        target: `${deployment.packageId}::fusion_relayer::complete_order`,
        typeArguments: ['0x2::sui::SUI'],
        arguments: [
            completeTx.object(deployment.hubId),
            completeTx.object(htlcId),
            completeTx.pure(orderId.toString()),
            completeTx.pure(Array.from(secret)),
            completeTx.pure(Array.from(dstTxHash)),
            completeTx.object(clockId),
        ],
    });

    const completeResult = await client.signAndExecuteTransactionBlock({
        signer: relayerKey,
        transactionBlock: completeTx,
        options: {
            showEvents: true,
            showBalanceChanges: true,
        },
    });

    console.log('✅ Order completed:', completeResult.digest);

    // Check final state
    console.log('\n📊 Final State:');
    
    // Check relayer balance change
    const balanceChanges = completeResult.balanceChanges || [];
    const relayerChange = balanceChanges.find(
        change => change.owner?.AddressOwner === keys.relayer.address
    );
    
    if (relayerChange) {
        console.log(
            'Relayer received:', 
            Math.abs(Number(relayerChange.amount)) / 1e9, 
            'SUI'
        );
    }

    console.log('\n✅ Demo completed successfully!');
    console.log('The atomic swap has been executed across chains');
}

// Alternative demo: Cancel scenario
async function demoCancelFlow() {
    console.log('\n🚫 Cancel Scenario Demo\n');

    const client = new SuiClient({ url: getFullnodeUrl('testnet') });
    const aliceKey = new Ed25519Keypair();
    const alice = aliceKey.getPublicKey().toSuiAddress();

    console.log('Creating order that will be cancelled...');
    
    // In real scenario:
    // 1. Create order with HTLC
    // 2. Wait for timeout
    // 3. Call cancel_order to refund

    console.log('Order can be cancelled if relayer doesn\'t fulfill it');
}

// Run demo
demoFusionFlow()
    .then(() => demoCancelFlow())
    .catch(console.error);