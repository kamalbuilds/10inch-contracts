import { Wallet } from 'xrpl';
import { XRPHTLC, HTLCParams, HTLCResponse } from './xrp-htlc';
import { ethers } from 'ethers';

export interface CrossChainSwapParams {
    sourceChain: 'XRP' | 'ETH' | 'SEPOLIA';
    targetChain: 'XRP' | 'ETH' | 'SEPOLIA';
    sourceAmount: string;
    targetAmount: string;
    sourceToken?: string; // For EVM chains
    targetToken?: string; // For EVM chains
    receiverAddress: string;
    timelockDuration?: number; // In seconds, default 3600 (1 hour)
}

export interface SwapOrder {
    id: string;
    sourceChain: string;
    targetChain: string;
    sourceAmount: string;
    targetAmount: string;
    secret?: Buffer;
    hashlock: Buffer;
    timelock: number;
    status: 'created' | 'locked' | 'redeemed' | 'refunded' | 'expired';
    sourceTxHash?: string;
    targetTxHash?: string;
    escrowSequence?: number;
}

export class XRPFusionClient {
    private xrpHTLC: XRPHTLC;
    private wallet?: Wallet;
    private pendingSwaps: Map<string, SwapOrder> = new Map();

    constructor(
        private rpcUrl: string = 'wss://s.altnet.rippletest.net:51233'
    ) {
        this.xrpHTLC = new XRPHTLC(rpcUrl);
    }

    // Initialize with a wallet (from seed or mnemonic)
    async init(seedOrMnemonic?: string): Promise<void> {
        if (seedOrMnemonic) {
            if (seedOrMnemonic.startsWith('s')) {
                // It's a seed
                this.wallet = Wallet.fromSeed(seedOrMnemonic);
            } else {
                // It's a mnemonic
                this.wallet = Wallet.fromMnemonic(seedOrMnemonic);
            }
        } else {
            // Generate new wallet
            this.wallet = this.xrpHTLC.generateWallet();
        }
        
        this.xrpHTLC.setWallet(this.wallet);
        await this.xrpHTLC.connect();
        
        console.log('XRP Fusion Client initialized');
        console.log('Wallet address:', this.wallet.address);
    }

    getWalletAddress(): string {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }
        return this.wallet.address;
    }

    async getBalance(): Promise<string> {
        return await this.xrpHTLC.getBalance();
    }

    // Create HTLC on XRP Ledger
    async createHTLC(params: {
        receiver: string;
        amount: string; // In XRP
        hashlock: Buffer;
        timelock: number;
    }): Promise<{ success: boolean; escrowSequence?: number; error?: string }> {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }

        const htlcParams: HTLCParams = {
            sender: this.wallet.address,
            receiver: params.receiver,
            amount: params.amount,
            hashlock: params.hashlock,
            timelock: params.timelock
        };

        const result = await this.xrpHTLC.createHTLC(htlcParams);
        
        if (result.success && result.sequence) {
            return {
                success: true,
                escrowSequence: result.sequence
            };
        }

        return {
            success: false,
            error: result.error
        };
    }

    // Claim HTLC with secret
    async claimHTLC(
        escrowOwner: string,
        escrowSequence: number,
        secret: Buffer
    ): Promise<HTLCResponse> {
        return await this.xrpHTLC.redeemHTLC(escrowOwner, escrowSequence, secret);
    }

    // Refund expired HTLC
    async refundHTLC(
        escrowOwner: string,
        escrowSequence: number
    ): Promise<HTLCResponse> {
        return await this.xrpHTLC.refundHTLC(escrowOwner, escrowSequence);
    }

    // Get HTLC details
    async getHTLC(escrowOwner: string, escrowSequence: number) {
        return await this.xrpHTLC.getEscrow(escrowOwner, escrowSequence);
    }

    // Initiate a cross-chain swap
    async initiateSwap(params: CrossChainSwapParams): Promise<SwapOrder> {
        const { secret, hashlock } = XRPHTLC.generateSecret();
        const timelock = Math.floor(Date.now() / 1000) + (params.timelockDuration || 3600);
        
        const swapOrder: SwapOrder = {
            id: this.generateSwapId(),
            sourceChain: params.sourceChain,
            targetChain: params.targetChain,
            sourceAmount: params.sourceAmount,
            targetAmount: params.targetAmount,
            secret,
            hashlock,
            timelock,
            status: 'created'
        };

        this.pendingSwaps.set(swapOrder.id, swapOrder);
        
        // If source chain is XRP, create HTLC
        if (params.sourceChain === 'XRP') {
            const result = await this.createHTLC({
                receiver: params.receiverAddress,
                amount: params.sourceAmount,
                hashlock,
                timelock
            });

            if (result.success) {
                swapOrder.status = 'locked';
                swapOrder.escrowSequence = result.escrowSequence;
            }
        }

        return swapOrder;
    }

    // Complete swap by revealing secret
    async completeSwap(
        swapId: string,
        escrowOwner: string,
        escrowSequence: number
    ): Promise<boolean> {
        const swap = this.pendingSwaps.get(swapId);
        if (!swap || !swap.secret) {
            throw new Error('Swap not found or secret not available');
        }

        const result = await this.claimHTLC(escrowOwner, escrowSequence, swap.secret);
        
        if (result.success) {
            swap.status = 'redeemed';
            swap.targetTxHash = result.txHash;
            return true;
        }

        return false;
    }

    // Monitor escrow for secret reveal (for resolver service)
    async monitorEscrowForSecret(
        escrowOwner: string,
        escrowSequence: number,
        callback: (secret: string) => void
    ): Promise<void> {
        // In a real implementation, this would monitor the ledger for
        // EscrowFinish transactions and extract the secret from the fulfillment
        // For now, this is a placeholder
        console.log('Monitoring escrow for secret reveal...');
    }

    private generateSwapId(): string {
        return `xrp_swap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    // Utility function to convert XRP address to EVM-compatible format
    static xrpAddressToHex(xrpAddress: string): string {
        // Convert XRP address to hex for cross-chain compatibility
        return '0x' + Buffer.from(xrpAddress).toString('hex').padEnd(64, '0');
    }

    // Utility function to extract XRP address from hex
    static hexToXrpAddress(hex: string): string {
        // Extract XRP address from hex representation
        const cleanHex = hex.replace('0x', '').replace(/0+$/, '');
        return Buffer.from(cleanHex, 'hex').toString();
    }
}