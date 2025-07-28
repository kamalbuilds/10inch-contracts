import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as solc from 'solc';

dotenv.config();

// Configuration
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com';
const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;

interface DeploymentInfo {
    network: string;
    contractAddress: string;
    deploymentBlock: number;
    deploymentTx: string;
    deployer: string;
    timestamp: string;
    abi: any[];
}

function compileSolidity(sourceCode: string) {
    const input = {
        language: 'Solidity',
        sources: {
            'SimpleHTLC.sol': {
                content: sourceCode
            }
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ['abi', 'evm.bytecode']
                }
            }
        }
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    
    if (output.errors) {
        output.errors.forEach((err: any) => {
            console.error(err.formattedMessage);
        });
        if (output.errors.some((err: any) => err.severity === 'error')) {
            throw new Error('Compilation failed');
        }
    }

    const contract = output.contracts['SimpleHTLC.sol']['SimpleHTLC'];
    return {
        abi: contract.abi,
        bytecode: contract.evm.bytecode.object
    };
}

async function deploySimpleHTLC() {
    console.log('🚀 Deploying SimpleHTLC contract to Sepolia...\n');

    if (!PRIVATE_KEY) {
        console.log('⚠️  Warning: SEPOLIA_PRIVATE_KEY not found in .env file');
        console.log('📝 To deploy, add SEPOLIA_PRIVATE_KEY to your .env file');
        console.log('💡 For now, using a placeholder address for testing\n');
        
        // Return mock deployment info for testing
        const mockDeployment: DeploymentInfo = {
            network: 'sepolia',
            contractAddress: '0x1234567890123456789012345678901234567890',
            deploymentBlock: 5000000,
            deploymentTx: '0x' + '0'.repeat(64),
            deployer: '0x' + '0'.repeat(40),
            timestamp: new Date().toISOString(),
            abi: [] // Will be filled when actual deployment happens
        };
        
        const deploymentPath = path.join(__dirname, 'sepolia-htlc-deployment.json');
        fs.writeFileSync(deploymentPath, JSON.stringify(mockDeployment, null, 2));
        console.log('📄 Mock deployment info saved to:', deploymentPath);
        
        return mockDeployment;
    }

    try {
        // Read and compile contract
        console.log('📄 Reading contract source...');
        const sourceCode = fs.readFileSync(
            path.join(__dirname, 'contracts', 'SimpleHTLC.sol'),
            'utf-8'
        );
        
        console.log('🔨 Compiling contract...');
        const { abi, bytecode } = compileSolidity(sourceCode);
        console.log('✅ Contract compiled successfully');

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

        // Deploy contract
        console.log('\n🔗 Deploying SimpleHTLC...');
        const factory = new ethers.ContractFactory(abi, bytecode, wallet);
        const contract = await factory.deploy();
        
        console.log('⏳ Waiting for deployment...');
        await contract.waitForDeployment();
        const contractAddress = await contract.getAddress();
        const deploymentTx = contract.deploymentTransaction()!;
        
        console.log('✅ SimpleHTLC deployed at:', contractAddress);
        console.log('📝 Deployment transaction:', deploymentTx.hash);

        // Get deployment block
        const txReceipt = await provider.getTransactionReceipt(deploymentTx.hash);
        const deploymentBlock = txReceipt!.blockNumber;
        
        // Save deployment info
        const deploymentInfo: DeploymentInfo = {
            network: 'sepolia',
            contractAddress,
            deploymentBlock,
            deploymentTx: deploymentTx.hash,
            deployer: wallet.address,
            timestamp: new Date().toISOString(),
            abi
        };

        // Save to JSON file
        const deploymentPath = path.join(__dirname, 'sepolia-htlc-deployment.json');
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        console.log('\n📄 Deployment info saved to:', deploymentPath);

        // Update shared deployment file
        const sharedDeploymentPath = path.join(__dirname, '..', 'shared-htlc-deployment.json');
        const sharedDeployment = {
            sepolia: deploymentInfo,
            goerli: null, // Deprecated
            mumbai: null, // Deprecated
            fuji: null, // Avalanche testnet
            bscTestnet: null, // BSC testnet
            arbitrumSepolia: null,
            optimismSepolia: null,
            baseSepolia: null
        };
        
        // Check if shared file exists and merge
        if (fs.existsSync(sharedDeploymentPath)) {
            const existing = JSON.parse(fs.readFileSync(sharedDeploymentPath, 'utf-8'));
            Object.assign(sharedDeployment, existing);
            sharedDeployment.sepolia = deploymentInfo;
        }
        
        fs.writeFileSync(sharedDeploymentPath, JSON.stringify(sharedDeployment, null, 2));
        console.log('📄 Shared deployment info saved to:', sharedDeploymentPath);

        console.log('\n🎉 Deployment complete!');
        console.log('\n📋 Summary:');
        console.log('- Contract:', contractAddress);
        console.log('- Network: Sepolia');
        console.log('- Block:', deploymentBlock);
        console.log('- Deployer:', wallet.address);
        
        console.log('\n📌 Next steps:');
        console.log('1. Verify contract on Etherscan (optional)');
        console.log('2. Update test configurations with the contract address');
        console.log('3. Use this contract for all non-EVM to EVM testing');
        
        return deploymentInfo;
    } catch (error) {
        console.error('❌ Deployment failed:', error);
        throw error;
    }
}

// Run deployment
if (require.main === module) {
    deploySimpleHTLC()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

export { deploySimpleHTLC };