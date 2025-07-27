import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const NETWORK = 'testnet';
const HTLC_WASM_PATH = '/Users/kamal/Desktop/1inch/stellar-integration/htlc-contract/target/wasm32-unknown-unknown/release/fusion_htlc.optimized.wasm';
const RELAYER_WASM_PATH = '/Users/kamal/Desktop/1inch/stellar-integration/relayer-contract/target/wasm32-unknown-unknown/release/fusion_relayer.optimized.wasm';

async function deployContracts() {
    console.log('🚀 Deploying Stellar Fusion+ contracts to testnet...\n');
    
    try {
        // Check if WASM files exist
        if (!fs.existsSync(HTLC_WASM_PATH)) {
            throw new Error(`HTLC WASM file not found at ${HTLC_WASM_PATH}. Please build and optimize first.`);
        }
        if (!fs.existsSync(RELAYER_WASM_PATH)) {
            throw new Error(`Relayer WASM file not found at ${RELAYER_WASM_PATH}. Please build and optimize first.`);
        }
        
        // Get deployer address
        const deployerAddress = execSync(`stellar keys address deployer`).toString().trim();
        console.log(`💳 Deployer address: ${deployerAddress}`);
        
        // Deploy HTLC contract directly
        console.log('\n📦 Deploying Fusion HTLC contract...');
        console.log(`Command: stellar contract deploy --wasm ${HTLC_WASM_PATH} --source deployer --network ${NETWORK}`);
        
        const deployResult = execSync(
            `stellar contract deploy --wasm ${HTLC_WASM_PATH} --source deployer --network ${NETWORK}`,
            { encoding: 'utf-8' }
        );
        
        const contractId = deployResult.trim();
        console.log(`✅ HTLC Contract deployed at: ${contractId}`);
        
        // Initialize the HTLC contract
        console.log('\n🔧 Initializing HTLC contract...');
        const initCommand = `stellar contract invoke --id ${contractId} --source deployer --network ${NETWORK} -- initialize --admin ${deployerAddress}`;
        console.log(`Command: ${initCommand}`);
        
        execSync(initCommand, { stdio: 'inherit' });
        console.log('✅ HTLC Contract initialized');
        
        // Deploy Relayer contract
        console.log('\n📦 Deploying Fusion Relayer contract...');
        console.log(`Command: stellar contract deploy --wasm ${RELAYER_WASM_PATH} --source deployer --network ${NETWORK}`);
        
        const relayerResult = execSync(
            `stellar contract deploy --wasm ${RELAYER_WASM_PATH} --source deployer --network ${NETWORK}`,
            { encoding: 'utf-8' }
        );
        
        const relayerContractId = relayerResult.trim();
        console.log(`✅ Relayer Contract deployed at: ${relayerContractId}`);
        
        // Initialize the Relayer contract
        console.log('\n🔧 Initializing Relayer contract...');
        const relayerInitCommand = `stellar contract invoke --id ${relayerContractId} --source deployer --network ${NETWORK} -- initialize --admin ${deployerAddress} --htlc_contract ${contractId}`;
        console.log(`Command: ${relayerInitCommand}`);
        
        execSync(relayerInitCommand, { stdio: 'inherit' });
        console.log('✅ Relayer Contract initialized');
        
        // Save deployment info
        const deploymentInfo = {
            network: NETWORK,
            deployer: deployerAddress,
            contracts: {
                htlc: contractId,
                relayer: relayerContractId
            },
            deployedAt: new Date().toISOString()
        };
        
        fs.writeFileSync(
            path.join(__dirname, 'stellar-deployment.json'),
            JSON.stringify(deploymentInfo, null, 2)
        );
        
        console.log('\n🎉 Deployment completed successfully!');
        console.log('\nDeployment info saved to stellar-deployment.json');
        console.log('\nContract IDs:');
        console.log(`  HTLC: ${contractId}`);
        console.log(`  Relayer: ${relayerContractId}`);
        
    } catch (error) {
        console.error('\n❌ Deployment failed:', error);
        process.exit(1);
    }
}

// Run deployment
deployContracts().catch(console.error);