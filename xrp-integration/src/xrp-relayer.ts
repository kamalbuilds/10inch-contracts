import { Client, Wallet } from 'xrpl';
import { ethers } from 'ethers';
import { XRPFusionClient } from './xrp-fusion-client';
import { XRPHTLC } from './xrp-htlc';

interface RelayerConfig {
    xrpRpcUrl: string;
    evmRpcUrl: string;
    evmHTLCAddress: string;
    evmHTLCABI: any[];
    xrpSeed: string;
    evmPrivateKey: string;
}

interface PendingSwap {
    sourceChain: 'XRP' | 'EVM';
    targetChain: 'XRP' | 'EVM';
    sourceTxHash: string;
    hashlock: string;
    timelock: number;
    amount: string;
    sender: string;
    receiver: string;
    escrowSequence?: number;
    htlcId?: string;
}

export class XRPRelayer {
    private xrpClient: Client;
    private xrpWallet: Wallet;
    private xrpFusion: XRPFusionClient;
    private evmProvider: ethers.Provider;
    private evmWallet: ethers.Wallet;
    private evmHTLC: ethers.Contract;
    private pendingSwaps: Map<string, PendingSwap> = new Map();
    private monitoring = false;

    constructor(private config: RelayerConfig) {
        // Initialize XRP components
        this.xrpClient = new Client(config.xrpRpcUrl);
        this.xrpWallet = Wallet.fromSeed(config.xrpSeed);
        this.xrpFusion = new XRPFusionClient(config.xrpRpcUrl);
        
        // Initialize EVM components
        this.evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
        this.evmWallet = new ethers.Wallet(config.evmPrivateKey, this.evmProvider);
        this.evmHTLC = new ethers.Contract(
            config.evmHTLCAddress,
            config.evmHTLCABI,
            this.evmWallet
        );
    }

    async start(): Promise<void> {
        console.log('🚀 Starting XRP-EVM Relayer Service');
        
        // Connect to XRP Ledger
        await this.xrpClient.connect();
        await this.xrpFusion.init(this.config.xrpSeed);
        
        console.log('XRP Relayer Address:', this.xrpWallet.address);
        console.log('EVM Relayer Address:', this.evmWallet.address);
        
        this.monitoring = true;
        
        // Start monitoring both chains
        this.monitorXRPLedger();
        this.monitorEVMChain();
        
        console.log('✅ Relayer service started');
    }

    async stop(): Promise<void> {
        this.monitoring = false;
        await this.xrpClient.disconnect();
        console.log('🛑 Relayer service stopped');
    }

    // Monitor XRP Ledger for escrow creations
    private async monitorXRPLedger(): Promise<void> {
        console.log('👀 Monitoring XRP Ledger for escrow creations...');
        
        // Subscribe to transactions
        await this.xrpClient.request({
            command: 'subscribe',
            streams: ['transactions']
        });

        this.xrpClient.on('transaction', async (tx: any) => {
            if (!this.monitoring) return;
            
            // Check if it's an EscrowCreate transaction
            if (tx.transaction.TransactionType === 'EscrowCreate' && tx.meta.TransactionResult === 'tesSUCCESS') {
                await this.handleXRPEscrowCreation(tx);
            }
            
            // Check if it's an EscrowFinish transaction (to extract secret)
            if (tx.transaction.TransactionType === 'EscrowFinish' && tx.meta.TransactionResult === 'tesSUCCESS') {
                await this.handleXRPEscrowFinish(tx);
            }
        });
    }

    // Monitor EVM chain for HTLC creations
    private async monitorEVMChain(): Promise<void> {
        console.log('👀 Monitoring EVM chain for HTLC creations...');
        
        // Listen for HTLCCreated events
        this.evmHTLC.on('HTLCCreated', async (
            contractId: string,
            sender: string,
            receiver: string,
            amount: ethers.BigNumberish,
            hashlock: string,
            timelock: ethers.BigNumberish,
            event: any
        ) => {
            if (!this.monitoring) return;
            await this.handleEVMHTLCCreation({
                contractId,
                sender,
                receiver,
                amount: amount.toString(),
                hashlock,
                timelock: Number(timelock),
                txHash: event.transactionHash
            });
        });

        // Listen for HTLCWithdrawn events (to extract secret)
        this.evmHTLC.on('HTLCWithdrawn', async (
            contractId: string,
            preimage: string,
            event: any
        ) => {
            if (!this.monitoring) return;
            await this.handleEVMHTLCWithdraw({
                contractId,
                preimage,
                txHash: event.transactionHash
            });
        });
    }

    // Handle XRP escrow creation - create corresponding HTLC on EVM
    private async handleXRPEscrowCreation(tx: any): Promise<void> {
        try {
            const escrow = tx.transaction;
            
            // Extract escrow details
            const sender = escrow.Account;
            const receiver = escrow.Destination;
            const amount = escrow.Amount; // In drops
            const condition = escrow.Condition;
            const cancelAfter = escrow.CancelAfter;
            const sequence = escrow.Sequence;
            
            // Only process escrows with conditions (HTLCs)
            if (!condition) return;
            
            console.log(`\n🔄 New XRP Escrow detected from ${sender}`);
            console.log(`Amount: ${Number(amount) / 1000000} XRP`);
            console.log(`Sequence: ${sequence}`);
            
            // Extract hashlock from condition
            // Condition format: A0258020{hashlock}810102
            const hashlockHex = condition.substring(8, 72);
            
            // Calculate equivalent amount for EVM (simplified - in production use oracle)
            const evmAmount = ethers.parseEther('0.001'); // Placeholder
            
            // Create corresponding HTLC on EVM
            console.log('Creating corresponding HTLC on EVM...');
            
            const createTx = await this.evmHTLC.createHTLC(
                receiver, // Should be converted to EVM address
                '0x' + hashlockHex,
                cancelAfter - 1800, // 30 minutes less for safety
                { value: evmAmount, gasLimit: 300000 }
            );
            
            const receipt = await createTx.wait();
            const htlcId = receipt.logs[0].topics[1]; // Extract HTLC ID from event
            
            console.log('✅ EVM HTLC created:', htlcId);
            
            // Store swap details
            this.pendingSwaps.set(hashlockHex, {
                sourceChain: 'XRP',
                targetChain: 'EVM',
                sourceTxHash: tx.transaction.hash,
                hashlock: hashlockHex,
                timelock: cancelAfter,
                amount: amount,
                sender,
                receiver,
                escrowSequence: sequence,
                htlcId
            });
            
        } catch (error) {
            console.error('Error handling XRP escrow creation:', error);
        }
    }

    // Handle EVM HTLC creation - create corresponding escrow on XRP
    private async handleEVMHTLCCreation(data: any): Promise<void> {
        try {
            console.log(`\n🔄 New EVM HTLC detected from ${data.sender}`);
            console.log(`Amount: ${ethers.formatEther(data.amount)} ETH`);
            console.log(`Contract ID: ${data.contractId}`);
            
            // Extract hashlock (remove 0x prefix)
            const hashlockHex = data.hashlock.substring(2);
            const hashlock = Buffer.from(hashlockHex, 'hex');
            
            // Calculate equivalent XRP amount (simplified - in production use oracle)
            const xrpAmount = '10'; // 10 XRP placeholder
            
            // Create corresponding escrow on XRP
            console.log('Creating corresponding escrow on XRP Ledger...');
            
            const result = await this.xrpFusion.createHTLC({
                receiver: data.receiver, // Should be converted to XRP address
                amount: xrpAmount,
                hashlock,
                timelock: data.timelock - 1800 // 30 minutes less for safety
            });
            
            if (result.success) {
                console.log('✅ XRP Escrow created. Sequence:', result.escrowSequence);
                
                // Store swap details
                this.pendingSwaps.set(hashlockHex, {
                    sourceChain: 'EVM',
                    targetChain: 'XRP',
                    sourceTxHash: data.txHash,
                    hashlock: hashlockHex,
                    timelock: data.timelock,
                    amount: data.amount,
                    sender: data.sender,
                    receiver: data.receiver,
                    escrowSequence: result.escrowSequence,
                    htlcId: data.contractId
                });
            }
            
        } catch (error) {
            console.error('Error handling EVM HTLC creation:', error);
        }
    }

    // Handle XRP escrow finish - extract secret and claim EVM HTLC
    private async handleXRPEscrowFinish(tx: any): Promise<void> {
        try {
            const finish = tx.transaction;
            const fulfillment = finish.Fulfillment;
            
            if (!fulfillment) return;
            
            console.log('\n🔓 XRP Escrow finished, extracting secret...');
            
            // Extract secret from fulfillment
            // Fulfillment format: A0{length}80{length}{secret}
            const secretHex = this.extractSecretFromFulfillment(fulfillment);
            const secret = Buffer.from(secretHex, 'hex');
            
            // Calculate hashlock to find corresponding swap
            const hashlock = XRPHTLC.generateSecret().hashlock;
            const hashlockHex = hashlock.toString('hex');
            
            const swap = this.pendingSwaps.get(hashlockHex);
            if (swap && swap.sourceChain === 'XRP' && swap.htlcId) {
                console.log('Found corresponding EVM HTLC, claiming...');
                
                // Claim EVM HTLC with revealed secret
                const withdrawTx = await this.evmHTLC.withdraw(
                    swap.htlcId,
                    '0x' + secretHex,
                    { gasLimit: 200000 }
                );
                
                await withdrawTx.wait();
                console.log('✅ EVM HTLC claimed successfully');
                
                // Remove from pending swaps
                this.pendingSwaps.delete(hashlockHex);
            }
            
        } catch (error) {
            console.error('Error handling XRP escrow finish:', error);
        }
    }

    // Handle EVM HTLC withdraw - extract secret and claim XRP escrow
    private async handleEVMHTLCWithdraw(data: any): Promise<void> {
        try {
            console.log('\n🔓 EVM HTLC withdrawn, extracting secret...');
            
            const secretHex = data.preimage.substring(2);
            const secret = Buffer.from(secretHex, 'hex');
            
            // Calculate hashlock to find corresponding swap
            const hashlock = XRPHTLC.verifySecret(secret, Buffer.alloc(32));
            const hashlockHex = hashlock.toString('hex');
            
            const swap = this.pendingSwaps.get(hashlockHex);
            if (swap && swap.sourceChain === 'EVM' && swap.escrowSequence) {
                console.log('Found corresponding XRP Escrow, claiming...');
                
                // Claim XRP escrow with revealed secret
                const result = await this.xrpFusion.claimHTLC(
                    swap.sender,
                    swap.escrowSequence,
                    secret
                );
                
                if (result.success) {
                    console.log('✅ XRP Escrow claimed successfully');
                    
                    // Remove from pending swaps
                    this.pendingSwaps.delete(hashlockHex);
                }
            }
            
        } catch (error) {
            console.error('Error handling EVM HTLC withdraw:', error);
        }
    }

    // Extract secret from XRP fulfillment
    private extractSecretFromFulfillment(fulfillment: string): string {
        // Fulfillment format: A0{length}80{length}{secret}
        // Skip the first 6 characters (A0{length}80{length})
        const secretStart = 6;
        const lengthHex = fulfillment.substring(4, 6);
        const secretLength = parseInt(lengthHex, 16);
        const secretHex = fulfillment.substring(secretStart, secretStart + secretLength * 2);
        return secretHex;
    }
}