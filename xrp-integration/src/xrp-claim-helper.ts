import { Client, Wallet, EscrowFinish } from 'xrpl';
import { createHash } from 'crypto';

export class XRPClaimHelper {
    private client: Client;
    private wallet: Wallet;

    constructor(client: Client, wallet: Wallet) {
        this.client = client;
        this.wallet = wallet;
    }

    // Generate proper XRP fulfillment from preimage
    generateFulfillment(preimage: Buffer): string {
        // PREIMAGE-SHA-256 fulfillment format:
        // A0 (type) + length + 80 (preimage type) + preimage length + preimage
        const preimageHex = preimage.toString('hex').toUpperCase();
        const preimageLength = preimage.length;
        
        // Total content is: 80 + preimage length byte + preimage
        const totalLength = 1 + 1 + preimageLength; // type(1) + length(1) + data
        
        const totalLengthHex = totalLength.toString(16).padStart(2, '0').toUpperCase();
        const preimageLengthHex = preimageLength.toString(16).padStart(2, '0').toUpperCase();
        
        return 'A0' + totalLengthHex + '80' + preimageLengthHex + preimageHex;
    }

    async claimEscrow(
        escrowOwner: string,
        escrowSequence: number,
        secret: Buffer
    ): Promise<{ success: boolean; txHash?: string; error?: string }> {
        try {
            const fulfillment = this.generateFulfillment(secret);
            console.log('Generated fulfillment:', fulfillment);

            const escrowFinish: EscrowFinish = {
                TransactionType: 'EscrowFinish',
                Account: this.wallet.address,
                Owner: escrowOwner,
                OfferSequence: escrowSequence,
                Fulfillment: fulfillment
            };

            const prepared = await this.client.autofill(escrowFinish);
            const signed = this.wallet.sign(prepared);
            const result = await this.client.submitAndWait(signed.tx_blob);

            if (result.result.meta && typeof result.result.meta !== 'string') {
                const meta = result.result.meta;
                if (meta.TransactionResult === 'tesSUCCESS') {
                    return {
                        success: true,
                        txHash: result.result.hash
                    };
                }
                return {
                    success: false,
                    error: meta.TransactionResult
                };
            }

            return {
                success: false,
                error: 'Unknown error'
            };
        } catch (error: any) {
            return {
                success: false,
                error: error.message || 'Failed to claim escrow'
            };
        }
    }
}