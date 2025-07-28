import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import { fromHEX } from '@mysten/sui.js/utils';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// Load deployment info
import deploymentInfo from './deployment.json';

export const TEST_CONFIG = {
    // Sui Configuration
    sui: {
        network: 'testnet',
        packageId: deploymentInfo.packageId,
        modules: deploymentInfo.modules,
        swapRegistry: deploymentInfo.objects.swapRegistry!,
        rpcUrl: 'https://fullnode.testnet.sui.io:443',
    },
    
    // Ethereum Sepolia Configuration  
    sepolia: {
        chainId: 11155111,
        rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com',
        htlcContract: '0x067423CA883d8D54995735aDc1FA23c17e5b62cc', // Deployed SimpleHTLC
        escrowFactory: '0x1234567890123456789012345678901234567890', // Legacy - not used
    },
    
    // Test amounts
    testAmount: {
        sui: 100000000, // 0.1 SUI
        eth: '100000000000000000', // 0.1 ETH
    },
    
    // Timelock settings
    timelock: {
        duration: 7200000, // 2 hours in milliseconds
    }
};

// Helper to get Sui keypair
export function getSuiKeypair(): Ed25519Keypair {
    const privateKey = process.env.SUI_PRIVATE_KEY!;
    
    if (privateKey.startsWith('suiprivkey')) {
        const decoded = decodeSuiPrivateKey(privateKey);
        return Ed25519Keypair.fromSecretKey(decoded.secretKey);
    } else {
        const privateKeyBytes = fromHEX(privateKey);
        return Ed25519Keypair.fromSecretKey(privateKeyBytes);
    }
}

// Helper to get Ethereum wallet
export function getEthereumWallet(): ethers.Wallet | null {
    const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
    if (!privateKey) {
        console.log('⚠️  SEPOLIA_PRIVATE_KEY not found - using simulation mode');
        return null;
    }
    
    const provider = new ethers.JsonRpcProvider(TEST_CONFIG.sepolia.rpcUrl);
    return new ethers.Wallet(privateKey, provider);
}

// Generate test secret and hash
export function generateSecretAndHash() {
    // Generate a 32-byte secret
    const secret = ethers.randomBytes(32);
    const secretHex = ethers.hexlify(secret);
    
    // Calculate keccak256 hash
    const hashlock = ethers.keccak256(secret);
    
    return {
        secret: secretHex,
        secretBytes: Array.from(secret),
        hashlock: hashlock,
        hashlockBytes: Array.from(ethers.getBytes(hashlock))
    };
}

// Calculate future timelock
export function calculateTimelock(durationMs: number = TEST_CONFIG.timelock.duration): number {
    return Date.now() + durationMs;
}