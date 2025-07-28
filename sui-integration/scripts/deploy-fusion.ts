import { 
    SuiClient, 
    SuiTransactionBlockResponse,
    TransactionBlock,
    Ed25519Keypair,
    fromB64,
    PRIVATE_KEY_SIZE,
    getFullnodeUrl
} from '@mysten/sui.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

interface DeploymentResult {
    packageId: string;
    htlcModule: string;
    relayerModule: string;
    registryId: string;
    hubId: string;
    deployer: string;
    relayerAccount: string;
    timestamp: string;
}

async function deployFusionContracts() {
    console.log('🚀 Deploying 1inch Fusion+ on Sui...\n');

    // Initialize client
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });

    // Create deployer keypair
    const deployerKey = new Ed25519Keypair();
    const deployer = deployerKey.getPublicKey().toSuiAddress();
    console.log('📍 Deployer address:', deployer);

    // Fund deployer
    console.log('\n💰 Requesting funds from faucet...');
    try {
        const response = await fetch('https://faucet.testnet.sui.io/v2/gas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                FixedAmountRequest: { recipient: deployer }
            })
        });
        
        if (response.ok) {
            console.log('✅ Faucet request successful');
            await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
            console.log('❌ Faucet failed, please fund manually:', deployer);
            process.exit(1);
        }
    } catch (error) {
        console.error('Faucet error:', error);
    }

    // Check balance
    const balance = await client.getBalance({ owner: deployer });
    console.log('Balance:', Number(balance.totalBalance) / 1e9, 'SUI');

    // Build package
    console.log('\n📦 Building Sui package...');
    const packagePath = path.join(__dirname, '..');
    
    try {
        execSync(`sui move build --path ${packagePath}`, { stdio: 'inherit' });
        console.log('✅ Package built successfully');
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }

    // Publish package
    console.log('\n🚀 Publishing package...');
    const publishTx = new TransactionBlock();
    const [upgradeCap] = publishTx.publish({
        modules: getCompiledModules(),
        dependencies: [
            '0x1', // Sui Framework
            '0x2', // Sui System
        ],
    });

    // Transfer upgrade capability
    publishTx.transferObjects([upgradeCap], publishTx.pure(deployer));

    const publishResult = await client.signAndExecuteTransactionBlock({
        signer: deployerKey,
        transactionBlock: publishTx,
        options: {
            showObjectChanges: true,
            showEffects: true,
        },
    });

    console.log('✅ Package published!');
    console.log('Transaction:', publishResult.digest);

    // Extract package ID and object IDs
    const packageId = publishResult.objectChanges?.find(
        (change) => change.type === 'published'
    )?.packageId!;

    const registryId = publishResult.objectChanges?.find(
        (change) => change.type === 'created' && 
        change.objectType?.includes('HTLCRegistry')
    )?.objectId!;

    const hubId = publishResult.objectChanges?.find(
        (change) => change.type === 'created' && 
        change.objectType?.includes('RelayerHub')
    )?.objectId!;

    console.log('Package ID:', packageId);
    console.log('Registry ID:', registryId);
    console.log('Hub ID:', hubId);

    // Create and add relayer
    console.log('\n👤 Setting up relayer account...');
    const relayerKey = new Ed25519Keypair();
    const relayerAddr = relayerKey.getPublicKey().toSuiAddress();

    // Fund relayer
    try {
        await fetch('https://faucet.testnet.sui.io/v2/gas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                FixedAmountRequest: { recipient: relayerAddr }
            })
        });
        await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
        console.log('Faucet error for relayer:', error);
    }

    // Add relayer to hub
    const addRelayerTx = new TransactionBlock();
    addRelayerTx.moveCall({
        target: `${packageId}::fusion_relayer::add_relayer`,
        arguments: [
            addRelayerTx.object(hubId),
            addRelayerTx.pure(relayerAddr),
        ],
    });

    await client.signAndExecuteTransactionBlock({
        signer: deployerKey,
        transactionBlock: addRelayerTx,
    });

    console.log('✅ Relayer added:', relayerAddr);

    // Save deployment info
    const deployment: DeploymentResult = {
        packageId,
        htlcModule: `${packageId}::fusion_htlc`,
        relayerModule: `${packageId}::fusion_relayer`,
        registryId,
        hubId,
        deployer,
        relayerAccount: relayerAddr,
        timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(
        path.join(__dirname, 'deployment.json'),
        JSON.stringify(deployment, null, 2)
    );

    // Save keys (for demo only - never do this in production!)
    fs.writeFileSync(
        path.join(__dirname, 'keys.json'),
        JSON.stringify({
            deployer: {
                address: deployer,
                privateKey: deployerKey.export().privateKey,
            },
            relayer: {
                address: relayerAddr,
                privateKey: relayerKey.export().privateKey,
            }
        }, null, 2)
    );

    console.log('\n📊 Deployment Summary:');
    console.log('=======================');
    console.log('Package ID:', packageId);
    console.log('HTLC Module:', deployment.htlcModule);
    console.log('Relayer Module:', deployment.relayerModule);
    console.log('Registry:', registryId);
    console.log('Hub:', hubId);
    console.log('\n✅ Deployment completed successfully!');
}

function getCompiledModules(): Uint8Array[] {
    const buildPath = path.join(__dirname, '..', 'build', 'fusion_swap_sui', 'bytecode_modules');
    const modules: Uint8Array[] = [];
    
    if (fs.existsSync(buildPath)) {
        const files = fs.readdirSync(buildPath);
        for (const file of files) {
            if (file.endsWith('.mv')) {
                const modulePath = path.join(buildPath, file);
                const moduleBytes = fs.readFileSync(modulePath);
                modules.push(new Uint8Array(moduleBytes));
            }
        }
    }
    
    return modules;
}

deployFusionContracts().catch(console.error);