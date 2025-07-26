import { Credential, OutRef } from '@lucid-evolution/lucid';

export interface HTLCParams {
  secretHash: string;
  recipient: string;
  sender: string;
  amount: bigint;
  timeout: number;
  minPartialAmount?: bigint;
}

export interface HTLCDatum {
  secret_hash: string;
  recipient: string;
  sender: string;
  timeout: bigint;
  amount: bigint;
  min_partial_amount: bigint;
}

export enum HTLCRedeemer {
  ClaimWithSecret = 0,
  ClaimTimeout = 1,
}

export interface ClaimWithSecretRedeemer {
  ClaimWithSecret: {
    secret: string;
    partial_amount?: bigint;
  };
}

export interface ClaimTimeoutRedeemer {
  ClaimTimeout: {};
}

export interface CrossChainSwapParams {
  sourceChain: 'cardano' | 'ethereum' | 'polygon' | 'bsc';
  targetChain: 'cardano' | 'ethereum' | 'polygon' | 'bsc';
  amount: bigint;
  recipient: string;
  timelockDuration?: number;
  minPartialAmount?: bigint;
}

export interface SwapOrder {
  id: string;
  sourceChain: string;
  targetChain: string;
  sourceHTLCId?: string;
  targetHTLCId?: string;
  amount: bigint;
  secret?: string;
  secretHash: string;
  status: 'pending' | 'locked' | 'claimed' | 'refunded';
  createdAt: number;
  timeout: number;
}

export interface HTLCState {
  utxo: OutRef;
  datum: HTLCDatum;
  value: bigint;
  claimed: boolean;
  refunded: boolean;
}