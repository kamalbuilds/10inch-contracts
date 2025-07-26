import { 
    Address, 
    beginCell, 
    Cell, 
    Contract, 
    contractAddress, 
    ContractProvider, 
    Sender, 
    SendMode,
    toNano,
    TupleBuilder
} from '@ton/core';
import { sha256 } from '@ton/crypto';

export type FusionHTLCConfig = {
    id: number;
    code: Cell;
    data: Cell;
};

export type HTLCData = {
    id: number;
    sender: Address;
    receiver: Address;
    amount: bigint;
    hashlock: Buffer;
    timelock: number;
    secret: Buffer;
    claimed: boolean;
    refunded: boolean;
    createdAt: number;
};

export function fusionHTLCConfigToCell(config: FusionHTLCConfig): Cell {
    return beginCell()
        .storeUint(0, 32) // next_htlc_id
        .storeDict(null) // empty htlcs dictionary
        .endCell();
}

export const Opcodes = {
    createHTLC: 0x1,
    claim: 0x2,
    refund: 0x3,
    addSafetyDeposit: 0x4,
    claimSafetyDeposit: 0x5,
};

export class FusionHTLC implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new FusionHTLC(address);
    }

    static createFromConfig(config: FusionHTLCConfig, code: Cell, workchain = 0) {
        const data = beginCell()
            .storeUint(0, 32) // next_htlc_id
            .storeDict() // empty htlcs dictionary
            .endCell();
        const init = { code, data };
        return new FusionHTLC(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendCreateHTLC(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            amount: bigint;
            receiver: Address;
            hashlock: Buffer;
            timelock: number;
            queryId?: number;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.createHTLC, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeAddress(opts.receiver)
                .storeBuffer(opts.hashlock, 32)
                .storeUint(opts.timelock, 32)
                .endCell(),
        });
    }

    async sendClaim(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            htlcId: number;
            secret: Buffer;
            queryId?: number;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.claim, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeUint(opts.htlcId, 32)
                .storeBuffer(opts.secret, 32)
                .endCell(),
        });
    }

    async sendRefund(
        provider: ContractProvider,
        via: Sender,
        opts: {
            value: bigint;
            htlcId: number;
            queryId?: number;
        }
    ) {
        await provider.internal(via, {
            value: opts.value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Opcodes.refund, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeUint(opts.htlcId, 32)
                .endCell(),
        });
    }

    async getHTLC(provider: ContractProvider, htlcId: number): Promise<HTLCData | null> {
        try {
            const builder = new TupleBuilder();
            builder.writeNumber(htlcId);
            
            const result = await provider.get('get_htlc', builder.build());
            
            const id = result.stack.readNumber();
            const sender = result.stack.readAddress();
            const receiver = result.stack.readAddress();
            const amount = result.stack.readBigNumber();
            const hashlock = result.stack.readBigNumber();
            const timelock = result.stack.readNumber();
            const secret = result.stack.readBigNumber();
            const claimed = result.stack.readBoolean();
            const refunded = result.stack.readBoolean();
            const createdAt = result.stack.readNumber();

            return {
                id,
                sender,
                receiver,
                amount,
                hashlock: Buffer.from(hashlock.toString(16).padStart(64, '0'), 'hex'),
                timelock,
                secret: Buffer.from(secret.toString(16).padStart(64, '0'), 'hex'),
                claimed,
                refunded,
                createdAt,
            };
        } catch (e) {
            return null;
        }
    }

    async getNextHTLCId(provider: ContractProvider): Promise<number> {
        const result = await provider.get('get_next_htlc_id', []);
        return result.stack.readNumber();
    }

    // Helper function to generate secret and hashlock
    static async generateSecret(): Promise<{ secret: Buffer; hashlock: Buffer }> {
        const secret = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
            secret[i] = Math.floor(Math.random() * 256);
        }
        const hashlock = await sha256(secret);
        return { secret, hashlock };
    }

    // Helper function to calculate timelock
    static calculateTimelock(durationSeconds: number): number {
        return Math.floor(Date.now() / 1000) + durationSeconds;
    }
}