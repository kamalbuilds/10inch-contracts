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

interface DeploymentInfo {
    network: string;
    deployer: string;
    packageId: string;
    modules: {
        fusion_htlc_v2: string;
        fusion_cross_chain: string;
    };
    objects: {
        swapRegistry?: string;
    };
    timestamp: string;
}

async function deployFusionPlus() {
    console.log('🚀 Deploying 1inch Fusion+ Sui Integration...\n');

    // Initialize Sui client
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });

    // Create keypair from private key
    let keypair: Ed25519Keypair;
    const privateKey = process.env.SUI_PRIVATE_KEY!;
    
    if (!privateKey) {
        console.error('❌ SUI_PRIVATE_KEY not found in .env file');
        return;
    }
    
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

        if (suiBalance < 0.1) {
            console.log('\n⚠️  Low balance! You might need more SUI for deployment.');
            console.log('Get testnet SUI from: https://discord.com/channels/916379725201563759/971488439931392130');
            console.log('Use !faucet', address);
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
        const modules = getCompiledModules();
        const [upgradeCap] = publishTx.publish({
            modules: modules.map(m => Array.from(m)),
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

        // Get the SwapRegistry object (should be created during module init)
        const swapRegistry = result.objectChanges?.find(
            (change) => change.type === 'created' && 
            change.objectType?.includes('SwapRegistry')
        );

        // Save deployment info
        const deploymentInfo: DeploymentInfo = {
            network: 'testnet',
            deployer: address,
            packageId: packageId,
            modules: {
                fusion_htlc_v2: `${packageId}::fusion_htlc_v2`,
                fusion_cross_chain: `${packageId}::fusion_cross_chain`,
            },
            objects: {
                swapRegistry: swapRegistry && 'objectId' in swapRegistry ? swapRegistry.objectId : undefined,
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
        console.log('HTLC Module:', `${packageId}::fusion_htlc_v2`);
        console.log('Cross-Chain Module:', `${packageId}::fusion_cross_chain`);
        if (swapRegistry && 'objectId' in swapRegistry) {
            console.log('Swap Registry:', swapRegistry.objectId);
        }
        console.log('\n🔗 View on Explorer:');
        console.log(`https://suiexplorer.com/object/${packageId}?network=testnet`);
        console.log('\n✅ Deployment completed successfully!');

        // Instructions for next steps
        console.log('\n📝 Next Steps:');
        console.log('1. Create test HTLCs using fusion_htlc_v2::create_htlc');
        console.log('2. Create cross-chain orders using fusion_cross_chain::create_outbound_order');
        console.log('3. Test withdraw and refund functions');
        console.log('4. Integrate with EVM side using the crosschain-resolver-example');

    } catch (error) {
        console.error('Error:', error);
    }
}

function getCompiledModules(): Uint8Array[] {
    const buildPath = path.join(process.cwd(), 'build', 'fusion_swap_sui', 'bytecode_modules');
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

// Run deployment
deployFusionPlus().catch(console.error);