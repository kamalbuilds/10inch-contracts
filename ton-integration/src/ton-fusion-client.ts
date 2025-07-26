import { 
    TonClient, 
    WalletContractV4, 
    Address,
    toNano,
    beginCell,
    Cell
} from '@ton/ton';
import { mnemonicToPrivateKey, KeyPair } from '@ton/crypto';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import { 
    HTLCState, 
    CrossChainSwapParams, 
    SwapOrder
} from './types';
import { 
    generateSecret, 
    calculateTimelock, 
    validateHashlock, 
    validateTimelock,
    generateSwapId
} from './utils';

export class TonFusionClient {
    private client: TonClient;
    private wallet: WalletContractV4 | null = null;
    private keyPair: KeyPair | null = null;
    private htlcContract: FusionHTLC | null = null;

    constructor(
        endpoint: string = 'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac55b0/api/v2/jsonRPC',
        private htlcAddress?: string
    ) {
        this.client = new TonClient({ endpoint });
    }

    async init(mnemonic: string[]) {
        this.keyPair = await mnemonicToPrivateKey(mnemonic);
        this.wallet = WalletContractV4.create({
            workchain: 0,
            publicKey: this.keyPair.publicKey,
        });

        if (this.htlcAddress) {
            this.htlcContract = FusionHTLC.createFromAddress(
                Address.parse(this.htlcAddress)
            );
        }
    }

    async deployHTLC(): Promise<Address> {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }

        const htlcCode = await this.getHTLCCode(); // You'll need to compile and load the contract code
        const htlc = FusionHTLC.createFromConfig(
            { id: 0, code: htlcCode, data: beginCell().endCell() },
            htlcCode
        );

        const deployAmount = toNano('0.1');
        
        const contract = this.client.open(htlc);
        const walletContract = this.client.open(this.wallet);
        await contract.sendDeploy(walletContract.sender(this.keyPair!.secretKey), deployAmount);

        this.htlcContract = htlc;
        this.htlcAddress = htlc.address.toString();
        
        return htlc.address;
    }

    async createHTLC(params: {
        receiver: string;
        amount: bigint;
        hashlock: Buffer;
        timelock: number;
    }): Promise<number> {
        if (!this.wallet || !this.htlcContract) {
            throw new Error('Wallet or HTLC contract not initialized');
        }

        // Validate inputs
        if (!validateHashlock(params.hashlock)) {
            throw new Error('Invalid hashlock');
        }
        if (!validateTimelock(params.timelock)) {
            throw new Error('Invalid timelock');
        }

        const contract = this.client.open(this.htlcContract);
        const walletContract = this.client.open(this.wallet);
        const sender = walletContract.sender(this.keyPair!.secretKey);

        // Get current HTLC ID before creating new one
        const currentId = await contract.getNextHTLCId();

        // Handle receiver address - if it's an EVM address, create a dummy TON address
        let receiverAddress: Address;
        try {
            receiverAddress = Address.parse(params.receiver);
        } catch (e) {
            // For cross-chain swaps, we use a special format
            // In production, this would be handled by a proper address mapping
            const dummyAddress = Address.parse('0QBJnR2aS6IiqThyLEEvdDAmv6_hf8Qmj_9UkC9R_5N62cRf');
            receiverAddress = dummyAddress;
            console.log("receiver address", receiverAddress);
        }
        
        await contract.sendCreateHTLC(sender, {
            value: params.amount + toNano('0.05'), // Add fee
            amount: params.amount,
            receiver: receiverAddress,
            hashlock: params.hashlock,
            timelock: params.timelock,
        });

        // Wait for transaction to be confirmed
        await this.waitForConfirmation();

        return currentId;
    }

    async claimHTLC(htlcId: number, secret: Buffer): Promise<void> {
        if (!this.wallet || !this.htlcContract) {
            throw new Error('Wallet or HTLC contract not initialized');
        }

        const contract = this.client.open(this.htlcContract);
        const walletContract = this.client.open(this.wallet);
        const sender = walletContract.sender(this.keyPair!.secretKey);

        await contract.sendClaim(sender, {
            value: toNano('0.05'), // Gas fee
            htlcId,
            secret,
        });

        await this.waitForConfirmation();
    }

    async refundHTLC(htlcId: number): Promise<void> {
        if (!this.wallet || !this.htlcContract) {
            throw new Error('Wallet or HTLC contract not initialized');
        }

        const contract = this.client.open(this.htlcContract);
        const walletContract = this.client.open(this.wallet);
        const sender = walletContract.sender(this.keyPair!.secretKey);

        await contract.sendRefund(sender, {
            value: toNano('0.05'), // Gas fee
            htlcId,
        });

        await this.waitForConfirmation();
    }

    async getHTLC(htlcId: number): Promise<HTLCState | null> {
        if (!this.htlcContract) {
            throw new Error('HTLC contract not initialized');
        }

        const contract = this.client.open(this.htlcContract);
        return await contract.getHTLC(htlcId);
    }

    async initiateSwap(params: CrossChainSwapParams): Promise<SwapOrder> {
        const { secret, hashlock } = await generateSecret();
        const timelock = calculateTimelock(params.timelockDuration || 3600);
        
        const swapOrder: SwapOrder = {
            id: generateSwapId(),
            sourceChain: params.sourceChain,
            targetChain: params.targetChain,
            sourceToken: params.sourceToken,
            targetToken: params.targetToken,
            sourceAmount: params.sourceAmount,
            targetAmount: params.targetAmount,
            sender: params.sender,
            receiver: params.receiver,
            hashlock,
            timelock,
            status: 'pending',
        };

        // Store the secret securely (in production, use secure storage)
        await this.storeSecret(swapOrder.id, secret);

        if (params.sourceChain === 'TON') {
            // Create HTLC on TON
            await this.createHTLC({
                receiver: params.receiver,
                amount: params.sourceAmount,
                hashlock,
                timelock,
            });
            
            // Update swap order
            swapOrder.status = 'locked';
        }

        return swapOrder;
    }

    async completeSwap(swapId: string): Promise<void> {
        const secret = await this.retrieveSecret(swapId);
        if (!secret) {
            throw new Error('Secret not found for swap');
        }

        // In production, you would need to track the HTLC ID associated with the swap
        // For now, this is a placeholder
        throw new Error('Complete swap not fully implemented');
    }

    private async getHTLCCode(): Promise<Cell> {
        // In production, you would load the compiled contract code
        // For now, returning a placeholder
        return beginCell().endCell();
    }

    private async waitForConfirmation(): Promise<void> {
        // Wait for transaction confirmation
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    private async storeSecret(swapId: string, secret: Buffer): Promise<void> {
        // In production, use secure storage (e.g., encrypted database)
        // For demo purposes, storing in memory
        (global as any).swapSecrets = (global as any).swapSecrets || {};
        (global as any).swapSecrets[swapId] = secret;
    }

    private async retrieveSecret(swapId: string): Promise<Buffer | null> {
        // In production, retrieve from secure storage
        return (global as any).swapSecrets?.[swapId] || null;
    }

    async getBalance(): Promise<bigint> {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }

        const contract = this.client.open(this.wallet);
        const balance = await contract.getBalance();
        return balance;
    }

    getWalletAddress(): string {
        if (!this.wallet) {
            throw new Error('Wallet not initialized');
        }
        return this.wallet.address.toString();
    }

    getHTLCAddress(): string {
        if (!this.htlcContract) {
            throw new Error('HTLC contract not initialized');
        }
        return this.htlcContract.address.toString();
    }
}