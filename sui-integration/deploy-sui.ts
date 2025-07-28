import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { fromHEX } from '@mysten/sui.js/utils';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

dotenv.config();

async function deploySuiContracts() {
    console.log('🚀 Deploying 1inch Fusion+ Sui Integration...\n');

    // Initialize Sui client
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });

    // Create keypair from private key - handle both formats
    let keypair: Ed25519Keypair;
    const privateKey = process.env.SUI_PRIVATE_KEY!;
    
    if (privateKey.startsWith('suiprivkey')) {
        // New format: decode the bech32 encoded key
        const decoded = decodeSuiPrivateKey(privateKey);
        keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
    } else {
        // Old format: hex encoded
        const privateKeyBytes = fromHEX(privateKey);
        keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
    }
    
    const address = keypair.getPublicKey().toSuiAddress();
    console.log('📍 Deployer Address:', address);

    // Check balance
    try {
        const balance = await client.getBalance({
            owner: address,
        });
        
        const suiBalance = parseInt(balance.totalBalance) / 1e9;
        console.log('💰 Balance:', suiBalance, 'SUI');

        if (suiBalance === 0) {
            console.log('\n⚠️  Account needs funding!');
            console.log('Please use the Sui testnet faucet:');
            console.log('Run: curl --location --request POST "https://faucet.testnet.sui.io/gas" --header "Content-Type: application/json" --data-raw \'{"FixedAmountRequest": {"recipient": "' + address + '"}}\'');
            console.log('\nOr visit: https://discord.com/channels/916379725201563759/971488439931392130');
            console.log('Use !faucet', address);
            return;
        }

        // Build the package
        console.log('\n📦 Building Sui Move package...');
        const packagePath = process.cwd();
        
        try {
            execSync(`sui move build --path ${packagePath}`, { stdio: 'inherit' });
            console.log('✅ Package built successfully');
        } catch (error) {
            console.error('❌ Build failed:', error);
            return;
        }

        // Publish the package
        console.log('\n🚀 Publishing package to Sui testnet...');
        
        const publishTx = new TransactionBlock();
        const [upgradeCap] = publishTx.publish({
            modules: getCompiledModules(),
            dependencies: getPackageDependencies(),
        });

        // Transfer upgrade capability to sender
        publishTx.transferObjects([upgradeCap], publishTx.pure(address));

        const result = await client.signAndExecuteTransactionBlock({
            signer: keypair,
            transactionBlock: publishTx,
            options: {
                showObjectChanges: true,
                showEffects: true,
            }
        });

        console.log('✅ Package published successfully!');
        console.log('Transaction digest:', result.digest);

        // Extract package ID
        const packageId = result.objectChanges?.find(
            (change) => change.type === 'published'
        )?.packageId;

        if (!packageId) {
            console.error('❌ Could not find package ID');
            return;
        }

        console.log('📦 Package ID:', packageId);

        // Initialize the swap module
        console.log('\n🔧 Initializing atomic swap module...');
        
        const initTx = new TransactionBlock();
        initTx.moveCall({
            target: `${packageId}::atomic_swap::initialize`,
            arguments: [],
        });

        const initResult = await client.signAndExecuteTransactionBlock({
            signer: keypair,
            transactionBlock: initTx,
            options: {
                showObjectChanges: true,
            }
        });

        console.log('✅ Atomic swap initialized');
        console.log('Init transaction:', initResult.digest);

        // Get the SwapEscrow object
        const swapEscrow = initResult.objectChanges?.find(
            (change) => change.type === 'created' && 
            change.objectType?.includes('SwapEscrow')
        );

        // Initialize cross-chain bridge
        console.log('\n🌉 Initializing cross-chain bridge...');
        
        const bridgeTx = new TransactionBlock();
        bridgeTx.moveCall({
            target: `${packageId}::cross_chain_bridge::initialize`,
            arguments: [],
        });

        const bridgeResult = await client.signAndExecuteTransactionBlock({
            signer: keypair,
            transactionBlock: bridgeTx,
            options: {
                showObjectChanges: true,
            }
        });

        console.log('✅ Cross-chain bridge initialized');
        console.log('Bridge transaction:', bridgeResult.digest);

        // Get the CrossChainBridge object
        const bridge = bridgeResult.objectChanges?.find(
            (change) => change.type === 'created' && 
            change.objectType?.includes('CrossChainBridge')
        );

        // Save deployment info
        const deploymentInfo = {
            network: 'testnet',
            deployer: address,
            packageId: packageId,
            modules: {
                atomic_swap: `${packageId}::atomic_swap`,
                cross_chain_bridge: `${packageId}::cross_chain_bridge`,
            },
            objects: {
                swapEscrow: swapEscrow?.objectId || 'Not found',
                crossChainBridge: bridge?.objectId || 'Not found',
            },
            transactions: {
                publish: result.digest,
                initSwap: initResult.digest,
                initBridge: bridgeResult.digest,
            },
            timestamp: new Date().toISOString(),
        };

        fs.writeFileSync(
            path.join(__dirname, 'deployment.json'),
            JSON.stringify(deploymentInfo, null, 2)
        );

        console.log('\n📊 Deployment Summary:');
        console.log('======================');
        console.log('Package ID:', packageId);
        console.log('Atomic Swap:', `${packageId}::atomic_swap`);
        console.log('Bridge:', `${packageId}::cross_chain_bridge`);
        console.log('Swap Escrow:', swapEscrow?.objectId || 'Not found');
        console.log('Bridge Object:', bridge?.objectId || 'Not found');
        console.log('\n🔗 View on Explorer:');
        console.log(`https://suiexplorer.com/object/${packageId}?network=testnet`);
        console.log('\n✅ Deployment completed successfully!');

    } catch (error) {
        console.error('Error:', error);
    }
}

function getCompiledModules(): Uint8Array[] {
    const buildPath = path.join(process.cwd(), 'build', 'fusion_plus_sui', 'bytecode_modules');
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

function getPackageDependencies(): string[] {
    // Read dependencies from Move.toml or package manifest
    return [
        '0x1', // Sui framework
        '0x2', // Sui standard library
    ];
}

// Check if we can request from faucet programmatically
async function requestFromFaucet(address: string) {
    try {
        const response = await fetch('https://faucet.testnet.sui.io/v2/gas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                FixedAmountRequest: {
                    recipient: address
                }
            })
        });

        if (response.ok) {
            console.log('✅ Faucet request successful');
            return true;
        } else {
            console.log('❌ Faucet request failed:', await response.text());
            return false;
        }
    } catch (error) {
        console.error('Error requesting from faucet:', error);
        return false;
    }
}

// Run deployment
deploySuiContracts().catch(console.error);