import { Address } from '@ton/core';

export interface HTLCParams {
    sender: Address;
    receiver: Address;
    amount: bigint;
    hashlock: Buffer;
    timelock: number;
}

export interface HTLCState {
    id: number;
    sender: Address;
    receiver: Address;
    amount: bigint;
    hashlock: Buffer;
    timelock: number;
    secret: Buffer | null;
    claimed: boolean;
    refunded: boolean;
    createdAt: number;
}

export interface SwapOrder {
    id: string;
    sourceChain: 'TON' | 'EVM';
    targetChain: 'TON' | 'EVM';
    sourceToken: string;
    targetToken: string;
    sourceAmount: bigint;
    targetAmount: bigint;
    sender: string;
    receiver: string;
    hashlock: Buffer;
    timelock: number;
    status: 'pending' | 'locked' | 'completed' | 'refunded';
}

export interface RelayerConfig {
    tonRpcUrl: string;
    evmRpcUrl: string;
    tonHTLCAddress: Address;
    evmHTLCAddress: string;
    walletMnemonic: string;
}

export interface CrossChainSwapParams {
    sourceChain: 'TON' | 'EVM';
    targetChain: 'TON' | 'EVM';
    sourceToken: string;
    targetToken: string;
    sourceAmount: bigint;
    targetAmount: bigint;
    sender: string;
    receiver: string;
    timelockDuration?: number; // in seconds, default 3600 (1 hour)
}

export enum SwapStatus {
    PENDING = 'pending',
    SOURCE_LOCKED = 'source_locked',
    TARGET_LOCKED = 'target_locked',
    COMPLETED = 'completed',
    REFUNDED = 'refunded',
    FAILED = 'failed'
}

export interface SwapEvent {
    type: 'htlc_created' | 'htlc_claimed' | 'htlc_refunded';
    chain: 'TON' | 'EVM';
    htlcId: string | number;
    timestamp: number;
    data: any;
}