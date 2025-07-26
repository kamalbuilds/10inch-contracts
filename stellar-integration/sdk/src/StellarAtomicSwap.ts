// Copyright (c) 1inch Network
// SPDX-License-Identifier: MIT

/**
 * Stellar Atomic Swap SDK
 * 
 * This SDK provides a comprehensive interface for interacting with Stellar atomic swap contracts.
 * It includes functions for creating, completing, and managing HTLC swaps and cross-chain bridges.
 */

import {
    Asset,
    Contract,
    Horizon,
    Keypair,
    Networks,
    Operation,
    Server,
    TransactionBuilder,
    xdr,
    Address,
    nativeToScVal,
    scValToNative,
    TimeoutInfinite,
} from '@stellar/stellar-sdk';
import { randomBytes, createHash } from 'crypto';
import BigNumber from 'bignumber.js';

// ============ Types and Interfaces ============

export interface StellarNetwork {
    name: string;
    networkPassphrase: string;
    horizonUrl: string;
    sorobanUrl: string;
}

export interface SwapState {
    id: string;
    initiator: string;
    recipient: string;
    amount: string;
    tokenAddress: string;
    secretHash: string;
    timelock: string;
    status: SwapStatus;
    createdAt: string;
    completedAt: string;
}

export enum SwapStatus {
    Active = 0,
    Completed = 1,
    Refunded = 2,
    Expired = 3,
}

export interface BridgeOrder {
    id: string;
    sourceChainId: number;
    destinationChainId: number;
    initiator: string;
    recipient: string;
    sourceAmount: string;
    minDestinationAmount: string;
    tokenAddress: string;
    secretHash: string;
    timelock: string;
    status: BridgeStatus;
    createdAt: string;
    completedAt: string;
    sourceTxHash: string;
    destinationTxHash: string;
}

export enum BridgeStatus {
    Pending = 0,
    Completed = 1,
    Cancelled = 2,
    Expired = 3,
}

export interface CreateSwapParams {
    amount: string;
    recipient: string;
    secretHash: string;
    timelock: string;
    tokenAddress?: string;
}

export interface CompleteSwapParams {
    swapId: string;
    secret: string;
}

export interface CreateBridgeOrderParams {
    amount: string;
    destinationChainId: number;
    recipient: string;
    secretHash: string;
    timelock: string;
    tokenAddress?: string;
}

export interface StellarAtomicSwapConfig {
    network: StellarNetwork;
    contractAddress: string;
    bridgeContractAddress?: string;
    keypair?: Keypair;
    horizonServer?: Server;
}

// ============ Constants ============

export const STELLAR_NETWORKS: Record<string, StellarNetwork> = {
    testnet: {
        name: 'Testnet',
        networkPassphrase: Networks.TESTNET,
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanUrl: 'https://soroban-testnet.stellar.org',
    },
    mainnet: {
        name: 'Mainnet',
        networkPassphrase: Networks.PUBLIC,
        horizonUrl: 'https://horizon.stellar.org',
        sorobanUrl: 'https://soroban.stellar.org',
    },
    futurenet: {
        name: 'Futurenet',
        networkPassphrase: Networks.FUTURENET,
        horizonUrl: 'https://horizon-futurenet.stellar.org',
        sorobanUrl: 'https://soroban-futurenet.stellar.org',
    },
};

export const SUPPORTED_CHAINS = {
    STELLAR: 1,
    ETHEREUM: 2,
    BITCOIN: 3,
    APTOS: 4,
    SUI: 5,
    POLYGON: 6,
    ARBITRUM: 7,
    OPTIMISM: 8,
    BSC: 9,
    AVALANCHE: 10,
} as const;

export const NATIVE_XLM_ASSET = Asset.native();
export const MIN_TIMELOCK_DURATION = 3600; // 1 hour in seconds
export const MAX_TIMELOCK_DURATION = 86400; // 24 hours in seconds
export const SECRET_LENGTH = 32; // 32 bytes

// ============ Main SDK Class ============

export class StellarAtomicSwap {
    private config: StellarAtomicSwapConfig;
    private server: Server;
    private contract: Contract;
    private bridgeContract?: Contract;

    constructor(config: StellarAtomicSwapConfig) {
        this.config = config;
        this.server = config.horizonServer || new Server(config.network.horizonUrl);
        this.contract = new Contract(config.contractAddress);
        
        if (config.bridgeContractAddress) {
            this.bridgeContract = new Contract(config.bridgeContractAddress);
        }
    }

    // ============ Utility Methods ============

    /**
     * Generate a cryptographically secure random secret
     */
    static generateSecret(): string {
        return randomBytes(SECRET_LENGTH).toString('hex');
    }

    /**
     * Generate hashlock from secret using SHA-256
     */
    static generateHashlock(secret: string): string {
        const secretBuffer = Buffer.from(secret, 'hex');
        return createHash('sha256').update(secretBuffer).digest('hex');
    }

    /**
     * Verify that a secret matches the given hashlock
     */
    static verifySecret(secret: string, hashlock: string): boolean {
        return this.generateHashlock(secret) === hashlock;
    }

    /**
     * Get current timestamp in seconds
     */
    static getCurrentTimestamp(): number {
        return Math.floor(Date.now() / 1000);
    }

    /**
     * Calculate timelock for given duration in seconds
     */
    static calculateTimelock(durationSeconds: number): string {
        const currentTime = this.getCurrentTimestamp();
        return (currentTime + durationSeconds).toString();
    }

    /**
     * Get account public key
     */
    getPublicKey(): string {
        if (!this.config.keypair) {
            throw new Error('No keypair configured');
        }
        return this.config.keypair.publicKey();
    }

    /**
     * Get account balance for XLM or custom asset
     */
    async getBalance(asset?: Asset): Promise<string> {
        const publicKey = this.getPublicKey();
        const account = await this.server.loadAccount(publicKey);
        
        const targetAsset = asset || NATIVE_XLM_ASSET;
        
        if (targetAsset.isNative()) {
            return account.balances.find(b => b.asset_type === 'native')?.balance || '0';
        } else {
            const balance = account.balances.find(b => 
                b.asset_type !== 'native' && 
                b.asset_code === targetAsset.code && 
                b.asset_issuer === targetAsset.issuer
            );
            return balance?.balance || '0';
        }
    }

    // ============ HTLC Swap Methods ============

    /**
     * Initialize the atomic swap contract
     */
    async initializeContract(protocolFeeRate: number): Promise<string> {
        if (!this.config.keypair) {
            throw new Error('No keypair configured for signing transactions');
        }

        const account = await this.server.loadAccount(this.getPublicKey());
        
        const operation = this.contract.call(
            'initialize',
            Address.fromString(this.getPublicKey()).toScVal(),
            nativeToScVal(protocolFeeRate, { type: 'u32' })
        );

        const transaction = new TransactionBuilder(account, {
            fee: '100',
            networkPassphrase: this.config.network.networkPassphrase,
        })
            .addOperation(operation)
            .setTimeout(TimeoutInfinite)
            .build();

        transaction.sign(this.config.keypair);
        
        const result = await this.server.submitTransaction(transaction);
        return result.hash;
    }

    /**
     * Create a new atomic swap
     */
    async createSwap(params: CreateSwapParams): Promise<{
        swapId: string;
        transactionHash: string;
        gasUsed: string;
    }> {
        if (!this.config.keypair) {
            throw new Error('No keypair configured for signing transactions');
        }

        // Validate parameters
        this.validateSwapParams(params);

        const account = await this.server.loadAccount(this.getPublicKey());
        
        const operation = this.contract.call(
            'create_swap',
            Address.fromString(this.getPublicKey()).toScVal(),
            Address.fromString(params.recipient).toScVal(),
            nativeToScVal(params.amount, { type: 'i128' }),
            Address.fromString(params.tokenAddress || this.config.contractAddress).toScVal(),
            nativeToScVal(Buffer.from(params.secretHash, 'hex'), { type: 'bytes' }),
            nativeToScVal(parseInt(params.timelock), { type: 'u64' })
        );

        const transaction = new TransactionBuilder(account, {
            fee: '100',
            networkPassphrase: this.config.network.networkPassphrase,
        })
            .addOperation(operation)
            .setTimeout(TimeoutInfinite)
            .build();

        transaction.sign(this.config.keypair);
        
        const result = await this.server.submitTransaction(transaction);
        
        // Extract swap ID from transaction result
        const swapId = this.extractSwapIdFromResult(result);
        
        return {
            swapId,
            transactionHash: result.hash,
            gasUsed: result.fee_charged,
        };
    }

    /**
     * Complete an atomic swap by revealing the secret
     */
    async completeSwap(params: CompleteSwapParams): Promise<{
        secret: string;
        transactionHash: string;
        gasUsed: string;
    }> {
        if (!this.config.keypair) {
            throw new Error('No keypair configured for signing transactions');
        }

        const account = await this.server.loadAccount(this.getPublicKey());
        
        const operation = this.contract.call(
            'complete_swap',
            nativeToScVal(parseInt(params.swapId), { type: 'u64' }),
            nativeToScVal(Buffer.from(params.secret, 'hex'), { type: 'bytes' })
        );

        const transaction = new TransactionBuilder(account, {
            fee: '100',
            networkPassphrase: this.config.network.networkPassphrase,
        })
            .addOperation(operation)
            .setTimeout(TimeoutInfinite)
            .build();

        transaction.sign(this.config.keypair);
        
        const result = await this.server.submitTransaction(transaction);
        
        return {
            secret: params.secret,
            transactionHash: result.hash,
            gasUsed: result.fee_charged,
        };
    }

    /**
     * Refund an expired atomic swap
     */
    async refundSwap(swapId: string): Promise<{
        transactionHash: string;
        gasUsed: string;
    }> {
        if (!this.config.keypair) {
            throw new Error('No keypair configured for signing transactions');
        }

        const account = await this.server.loadAccount(this.getPublicKey());
        
        const operation = this.contract.call(
            'refund_swap',
            nativeToScVal(parseInt(swapId), { type: 'u64' })
        );

        const transaction = new TransactionBuilder(account, {
            fee: '100',
            networkPassphrase: this.config.network.networkPassphrase,
        })
            .addOperation(operation)
            .setTimeout(TimeoutInfinite)
            .build();

        transaction.sign(this.config.keypair);
        
        const result = await this.server.submitTransaction(transaction);
        
        return {
            transactionHash: result.hash,
            gasUsed: result.fee_charged,
        };
    }

    // ============ View Methods ============

    /**
     * Get swap state information
     */
    async getSwap(swapId: string): Promise<SwapState | null> {
        try {
            const result = await this.contract.call(
                'get_swap',
                nativeToScVal(parseInt(swapId), { type: 'u64' })
            );

            // Convert result to SwapState
            return this.parseSwapState(result);
        } catch (error) {
            console.error('Error fetching swap:', error);
            return null;
        }
    }

    /**
     * Check if swap exists
     */
    async swapExists(swapId: string): Promise<boolean> {
        try {
            const result = await this.contract.call(
                'swap_exists',
                nativeToScVal(parseInt(swapId), { type: 'u64' })
            );
            return scValToNative(result) as boolean;
        } catch (error) {
            console.error('Error checking swap existence:', error);
            return false;
        }
    }

    /**
     * Check if swap is active
     */
    async isSwapActive(swapId: string): Promise<boolean> {
        try {
            const result = await this.contract.call(
                'is_swap_active',
                nativeToScVal(parseInt(swapId), { type: 'u64' })
            );
            return scValToNative(result) as boolean;
        } catch (error) {
            console.error('Error checking swap active status:', error);
            return false;
        }
    }

    /**
     * Check if swap can be refunded
     */
    async canRefund(swapId: string): Promise<boolean> {
        try {
            const result = await this.contract.call(
                'can_refund',
                nativeToScVal(parseInt(swapId), { type: 'u64' })
            );
            return scValToNative(result) as boolean;
        } catch (error) {
            console.error('Error checking refund status:', error);
            return false;
        }
    }

    /**
     * Get total number of swaps
     */
    async getSwapCount(): Promise<string> {
        try {
            const result = await this.contract.call('get_swap_count');
            return scValToNative(result).toString();
        } catch (error) {
            console.error('Error fetching swap count:', error);
            return '0';
        }
    }

    /**
     * Get protocol fee rate
     */
    async getProtocolFeeRate(): Promise<string> {
        try {
            const result = await this.contract.call('get_protocol_fee_rate');
            return scValToNative(result).toString();
        } catch (error) {
            console.error('Error fetching protocol fee rate:', error);
            return '0';
        }
    }

    // ============ Utility and Testing Methods ============

    /**
     * Create a test account with some XLM (for testing)
     */
    static async createTestAccount(network: string = 'testnet'): Promise<{
        keypair: Keypair;
        publicKey: string;
        secretKey: string;
    }> {
        const keypair = Keypair.random();
        const publicKey = keypair.publicKey();
        const secretKey = keypair.secret();

        // For testnet, we can fund the account using friendbot
        if (network === 'testnet') {
            try {
                const server = new Server('https://horizon-testnet.stellar.org');
                await server.friendbot(publicKey).call();
            } catch (error) {
                console.warn(`Failed to fund test account: ${error}`);
            }
        }

        return {
            keypair,
            publicKey,
            secretKey,
        };
    }

    // ============ Private Helper Methods ============

    private validateSwapParams(params: CreateSwapParams): void {
        if (!params.amount || new BigNumber(params.amount).lte(0)) {
            throw new Error('Invalid amount');
        }

        if (!params.secretHash || params.secretHash.length !== 64) {
            throw new Error('Invalid secret hash - must be 64 character hex string');
        }

        if (!params.timelock) {
            throw new Error('Timelock is required');
        }

        const timelockNum = parseInt(params.timelock);
        const currentTime = StellarAtomicSwap.getCurrentTimestamp();
        
        if (timelockNum <= currentTime + MIN_TIMELOCK_DURATION) {
            throw new Error(`Timelock must be at least ${MIN_TIMELOCK_DURATION} seconds in the future`);
        }

        if (timelockNum > currentTime + MAX_TIMELOCK_DURATION) {
            throw new Error(`Timelock cannot be more than ${MAX_TIMELOCK_DURATION} seconds in the future`);
        }

        if (!params.recipient) {
            throw new Error('Recipient is required');
        }
    }

    private extractSwapIdFromResult(result: any): string {
        // Parse transaction result to extract swap ID
        // This is a simplified implementation
        return '1';
    }

    private parseSwapState(result: any): SwapState {
        // Parse contract result to SwapState
        // This is a simplified implementation
        return {
            id: '1',
            initiator: '',
            recipient: '',
            amount: '0',
            tokenAddress: '',
            secretHash: '',
            timelock: '0',
            status: SwapStatus.Active,
            createdAt: '0',
            completedAt: '0',
        };
    }
}

export default StellarAtomicSwap; 