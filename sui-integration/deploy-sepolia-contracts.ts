import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Import contract ABIs and bytecodes
import EscrowFactoryContract from './contracts/EscrowFactory.json';
import EscrowSrcContract from './contracts/EscrowSrc.json';
import EscrowDstContract from './contracts/EscrowDst.json';

dotenv.config();

// Configuration
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com';
const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;

// 1inch Protocol addresses on Sepolia (placeholders - replace with actual)
const LIMIT_ORDER_PROTOCOL = '0x0000000000000000000000000000000000000000'; // TODO: Replace with actual
const FEE_TOKEN = '0x0000000000000000000000000000000000000000'; // TODO: Replace with actual (e.g., USDC)
const ACCESS_TOKEN = '0x0000000000000000000000000000000000000000'; // TODO: Replace with actual (e.g., 1INCH)

// Deployment configuration
const RESCUE_DELAY_SRC = 86400; // 1 day in seconds
const RESCUE_DELAY_DST = 86400; // 1 day in seconds

interface DeploymentInfo {
    network: string;
    escrowFactory: string;
    escrowSrcImpl: string;
    escrowDstImpl: string;
    deploymentBlock: number;
    deploymentTx: string;
    timestamp: string;
}

async function deployContracts() {
    console.log('🚀 Deploying 1inch Fusion+ contracts to Sepolia...\n');

    if (!PRIVATE_KEY) {
        throw new Error('SEPOLIA_PRIVATE_KEY not found in .env file');
    }

    // Setup provider and wallet
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    
    console.log('📍 Deployer address:', wallet.address);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log('💰 Deployer balance:', ethers.formatEther(balance), 'ETH');
    
    if (balance === 0n) {
        throw new Error('Deployer has no ETH balance. Please fund the account.');
    }

    try {
        // Deploy EscrowSrc implementation
        console.log('\n1️⃣ Deploying EscrowSrc implementation...');
        const EscrowSrcFactory = new ethers.ContractFactory(
            EscrowSrcContract.abi,
            EscrowSrcContract.bytecode,
            wallet
        );
        const escrowSrc = await EscrowSrcFactory.deploy();
        await escrowSrc.waitForDeployment();
        const escrowSrcAddress = await escrowSrc.getAddress();
        console.log('✅ EscrowSrc deployed at:', escrowSrcAddress);

        // Deploy EscrowDst implementation
        console.log('\n2️⃣ Deploying EscrowDst implementation...');
        const EscrowDstFactory = new ethers.ContractFactory(
            EscrowDstContract.abi,
            EscrowDstContract.bytecode,
            wallet
        );
        const escrowDst = await EscrowDstFactory.deploy();
        await escrowDst.waitForDeployment();
        const escrowDstAddress = await escrowDst.getAddress();
        console.log('✅ EscrowDst deployed at:', escrowDstAddress);

        // Deploy EscrowFactory
        console.log('\n3️⃣ Deploying EscrowFactory...');
        const EscrowFactoryFactory = new ethers.ContractFactory(
            EscrowFactoryContract.abi,
            EscrowFactoryContract.bytecode,
            wallet
        );
        
        const escrowFactory = await EscrowFactoryFactory.deploy(
            LIMIT_ORDER_PROTOCOL,
            FEE_TOKEN,
            ACCESS_TOKEN,
            wallet.address, // owner
            RESCUE_DELAY_SRC,
            RESCUE_DELAY_DST
        );
        
        const receipt = await escrowFactory.waitForDeployment();
        const escrowFactoryAddress = await escrowFactory.getAddress();
        const deploymentTx = escrowFactory.deploymentTransaction()!;
        
        console.log('✅ EscrowFactory deployed at:', escrowFactoryAddress);
        console.log('📝 Deployment transaction:', deploymentTx.hash);

        // Get deployment block
        const txReceipt = await provider.getTransactionReceipt(deploymentTx.hash);
        const deploymentBlock = txReceipt!.blockNumber;
        
        // Save deployment info
        const deploymentInfo: DeploymentInfo = {
            network: 'sepolia',
            escrowFactory: escrowFactoryAddress,
            escrowSrcImpl: escrowSrcAddress,
            escrowDstImpl: escrowDstAddress,
            deploymentBlock,
            deploymentTx: deploymentTx.hash,
            timestamp: new Date().toISOString()
        };

        // Save to JSON file
        const deploymentPath = path.join(__dirname, 'sepolia-deployment.json');
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        console.log('\n📄 Deployment info saved to:', deploymentPath);

        // Create shared deployment file for all non-EVM chains
        const sharedDeploymentPath = path.join(__dirname, '..', 'shared-evm-deployment.json');
        const sharedDeployment = {
            sepolia: deploymentInfo,
            mainnet: null, // To be added later
            arbitrum: null, // To be added later
            base: null, // To be added later
            optimism: null, // To be added later
            polygon: null, // To be added later
            avalanche: null, // To be added later
            bsc: null, // To be added later
        };
        
        // Check if shared file exists and merge
        if (fs.existsSync(sharedDeploymentPath)) {
            const existing = JSON.parse(fs.readFileSync(sharedDeploymentPath, 'utf-8'));
            sharedDeployment.sepolia = deploymentInfo;
            Object.assign(sharedDeployment, existing);
        }
        
        fs.writeFileSync(sharedDeploymentPath, JSON.stringify(sharedDeployment, null, 2));
        console.log('📄 Shared deployment info saved to:', sharedDeploymentPath);

        console.log('\n🎉 Deployment complete!');
        console.log('\n📋 Summary:');
        console.log('- EscrowFactory:', escrowFactoryAddress);
        console.log('- EscrowSrc:', escrowSrcAddress);
        console.log('- EscrowDst:', escrowDstAddress);
        console.log('- Owner:', wallet.address);
        console.log('- Block:', deploymentBlock);
        
        console.log('\n⚠️  IMPORTANT: Update the following in your code:');
        console.log('1. LIMIT_ORDER_PROTOCOL address');
        console.log('2. FEE_TOKEN address (e.g., USDC on Sepolia)');
        console.log('3. ACCESS_TOKEN address (e.g., 1INCH on Sepolia)');
        
        return deploymentInfo;
    } catch (error) {
        console.error('❌ Deployment failed:', error);
        throw error;
    }
}

// Run deployment
if (require.main === module) {
    deployContracts()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { deployContracts };