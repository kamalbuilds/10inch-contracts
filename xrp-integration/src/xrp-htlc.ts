import {
    Client,
    Wallet,
    xrpToDrops,
    dropsToXrp,
    EscrowCreate,
    EscrowFinish,
    EscrowCancel,
    Transaction,
    TransactionMetadata,
    convertStringToHex,
    TxResponse
} from 'xrpl';
import { createHash } from 'crypto';

export interface HTLCParams {
    sender: string;
    receiver: string;
    amount: string; // In XRP
    hashlock: Buffer;
    timelock: number; // Unix timestamp
}

export interface HTLCResponse {
    success: boolean;
    txHash?: string;
    escrowId?: string;
    sequence?: number;
    ledgerIndex?: number;
    error?: string;
}

export interface EscrowInfo {
    owner: string;
    amount: string;
    destination: string;
    condition?: string;
    cancelAfter?: number;
    finishAfter?: number;
    destinationTag?: number;
}

export class XRPHTLC {
    private client: Client;
    private wallet?: Wallet;

    constructor(serverUrl: string = 'wss://testnet.xrpl-labs.com') {
        this.client = new Client(serverUrl);
    }

    async connect(): Promise<void> {
        if (!this.client.isConnected()) {
            await this.client.connect();
            console.log('Connected to XRP Ledger');
        }
    }

    async disconnect(): Promise<void> {
        if (this.client.isConnected()) {
            await this.client.disconnect();
        }
    }

    setWallet(wallet: Wallet): void {
        this.wallet = wallet;
    }

    generateWallet(): Wallet {
        const wallet = Wallet.generate();
        this.wallet = wallet;
        return wallet;
    }

    // Generate a PREIMAGE-SHA-256 crypto condition from a hashlock
    generateCryptoCondition(hashlock: Buffer): string {
        // XRP Ledger uses PREIMAGE-SHA-256 conditions
        // Format: A0258020{32-byte-hash}810102
        const prefix = 'A0258020';
        const suffix = '810102';
        return prefix + hashlock.toString('hex').toUpperCase() + suffix;
    }

    // Generate fulfillment from secret
    generateFulfillment(secret: Buffer): string {
        // Format: A022{length-byte}20{secret}
        const secretHex = secret.toString('hex').toUpperCase();
        const lengthHex = (secret.length).toString(16).padStart(2, '0').toUpperCase();
        return 'A0' + lengthHex + '80' + (secret.length).toString(16).padStart(2, '0') + secretHex;
    }

    // Create an HTLC using XRP Ledger's escrow feature
    async createHTLC(params: HTLCParams): Promise<HTLCResponse> {
        try {
            console.log('Creating HTLC with params:', {
                sender: params.sender,
                receiver: params.receiver,
                amount: params.amount,
                hashlockLength: params.hashlock.length,
                timelock: params.timelock
            });

            if (!this.wallet) {
                throw new Error('Wallet not initialized');
            }

            await this.connect();

            // Generate crypto condition from hashlock
            const condition = this.generateCryptoCondition(params.hashlock);
            console.log('Generated condition:', condition);

            // Create escrow transaction
            const escrowTx: EscrowCreate = {
                TransactionType: 'EscrowCreate',
                Account: params.sender,
                Destination: params.receiver,
                Amount: xrpToDrops(params.amount),
                Condition: condition,
                CancelAfter: params.timelock,
            };
            console.log('Escrow transaction:', escrowTx);

            // Prepare and sign transaction
            const prepared = await this.client.autofill(escrowTx);
            console.log('Prepared transaction:', prepared);
            const signed = this.wallet.sign(prepared);
            console.log('Signed transaction hash:', signed.hash);
            
            // Submit transaction
            console.log('Submitting transaction...');
            try {
                const result = await this.client.submitAndWait(signed.tx_blob);
                console.log('Transaction result:', result);
                
                if (result.result.meta && typeof result.result.meta !== 'string') {
                    const meta = result.result.meta as TransactionMetadata;
                    if (meta.TransactionResult === 'tesSUCCESS') {
                        // Get the sequence from the submitted transaction
                        const txJson = (result.result as any).tx_json || result.result;
                        return {
                            success: true,
                            txHash: result.result.hash,
                            escrowId: result.result.hash,
                            sequence: prepared.Sequence,
                            ledgerIndex: result.result.ledger_index
                        };
                    }
                }

                return {
                    success: false,
                    error: 'Transaction failed'
                };
            } catch (submitError: any) {
                console.error('Submit error details:', submitError);
                throw submitError;
            }

        } catch (error: any) {
            console.error('HTLC creation error:', error);
            return {
                success: false,
                error: error.message || 'Unknown error'
            };
        }
    }

    // Redeem an HTLC by providing the secret
    async redeemHTLC(
        escrowOwner: string,
        escrowSequence: number,
        secret: Buffer
    ): Promise<HTLCResponse> {
        try {
            if (!this.wallet) {
                throw new Error('Wallet not initialized');
            }

            await this.connect();

            // Generate fulfillment from secret
            const fulfillment = this.generateFulfillment(secret);

            // Create escrow finish transaction
            const finishTx: EscrowFinish = {
                TransactionType: 'EscrowFinish',
                Account: this.wallet.address,
                Owner: escrowOwner,
                OfferSequence: escrowSequence,
                Fulfillment: fulfillment
            };

            // Prepare and sign transaction
            const prepared = await this.client.autofill(finishTx);
            const signed = this.wallet.sign(prepared);
            
            // Submit transaction
            const result = await this.client.submitAndWait(signed.tx_blob);
            
            if (result.result.meta && typeof result.result.meta !== 'string') {
                const meta = result.result.meta as TransactionMetadata;
                if (meta.TransactionResult === 'tesSUCCESS') {
                    return {
                        success: true,
                        txHash: result.result.hash,
                        ledgerIndex: result.result.ledger_index
                    };
                }
            }

            return {
                success: false,
                error: 'Transaction failed'
            };

        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Unknown error'
            };
        }
    }

    // Refund an expired HTLC
    async refundHTLC(
        escrowOwner: string,
        escrowSequence: number
    ): Promise<HTLCResponse> {
        try {
            if (!this.wallet) {
                throw new Error('Wallet not initialized');
            }

            await this.connect();

            // Create escrow cancel transaction
            const cancelTx: EscrowCancel = {
                TransactionType: 'EscrowCancel',
                Account: this.wallet.address,
                Owner: escrowOwner,
                OfferSequence: escrowSequence
            };

            // Prepare and sign transaction
            const prepared = await this.client.autofill(cancelTx);
            const signed = this.wallet.sign(prepared);
            
            // Submit transaction
            const result = await this.client.submitAndWait(signed.tx_blob);
            
            if (result.result.meta && typeof result.result.meta !== 'string') {
                const meta = result.result.meta as TransactionMetadata;
                if (meta.TransactionResult === 'tesSUCCESS') {
                    return {
                        success: true,
                        txHash: result.result.hash,
                        ledgerIndex: result.result.ledger_index
                    };
                }
            }

            return {
                success: false,
                error: 'Transaction failed'
            };

        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Unknown error'
            };
        }
    }

    // Get escrow information
    async getEscrow(
        escrowOwner: string,
        escrowSequence: number
    ): Promise<EscrowInfo | null> {
        try {
            await this.connect();

            const response = await this.client.request({
                command: 'account_objects',
                account: escrowOwner,
                type: 'escrow'
            });

            const escrows = response.result.account_objects as any[];
            const escrow = escrows.find((e: any) => 
                e.LedgerEntryType === 'Escrow' && e.Sequence === escrowSequence
            );

            if (escrow) {
                return {
                    owner: escrow.Account,
                    amount: String(dropsToXrp(escrow.Amount)),
                    destination: escrow.Destination,
                    condition: escrow.Condition,
                    cancelAfter: escrow.CancelAfter,
                    finishAfter: escrow.FinishAfter,
                    destinationTag: escrow.DestinationTag
                };
            }

            return null;

        } catch (error: any) {
            console.error('Error getting escrow:', error);
            return null;
        }
    }

    // Generate secret and hashlock
    static generateSecret(): { secret: Buffer; hashlock: Buffer } {
        const secret = Buffer.from(
            Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
        );
        const hashlock = createHash('sha256').update(secret).digest();
        return { secret, hashlock };
    }

    // Verify secret matches hashlock
    static verifySecret(secret: Buffer, hashlock: Buffer): boolean {
        const computedHash = createHash('sha256').update(secret).digest();
        return computedHash.equals(hashlock);
    }

    // Get account balance
    async getBalance(address?: string): Promise<string> {
        try {
            await this.connect();
            const addr = address || this.wallet?.address;
            if (!addr) throw new Error('No address provided');

            const response = await this.client.request({
                command: 'account_info',
                account: addr
            });

            const balance = response.result.account_data.Balance;
            return String(dropsToXrp(balance));
        } catch (error: any) {
            console.error('Error getting balance:', error);
            return '0';
        }
    }
}