import { sha256 } from '@ton/crypto';
import { Address } from '@ton/core';
import { ethers } from 'ethers';

export async function generateSecret(): Promise<{ secret: Buffer; hashlock: Buffer }> {
    const secret = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
        secret[i] = Math.floor(Math.random() * 256);
    }
    const hashlock = await sha256(secret);
    return { secret, hashlock };
}

export function calculateTimelock(durationSeconds: number = 3600): number {
    return Math.floor(Date.now() / 1000) + durationSeconds;
}

export function tonAddressToString(address: Address): string {
    return address.toString();
}

export function evmAddressToTon(evmAddress: string): string {
    // Convert EVM address to TON-compatible format
    // This is a simplified version - in production, you might want a more sophisticated mapping
    const cleanAddress = evmAddress.toLowerCase().replace('0x', '');
    return `0:${cleanAddress.padEnd(64, '0')}`;
}

export function tonAddressToEvm(tonAddress: string): string {
    // Convert TON address to EVM-compatible format
    // This is a simplified version - in production, you might want a more sophisticated mapping
    const parts = tonAddress.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid TON address format');
    }
    return `0x${parts[1].slice(0, 40)}`;
}

export function validateHashlock(hashlock: Buffer): boolean {
    return hashlock.length === 32;
}

export function validateTimelock(timelock: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const minDuration = 300; // 5 minutes minimum
    const maxDuration = 2592000; // 30 days
    
    return timelock > now + minDuration && timelock <= now + maxDuration;
}

export async function waitForTransaction(
    provider: any,
    txHash: string,
    confirmations: number = 1
): Promise<any> {
    const receipt = await provider.waitForTransaction(txHash, confirmations);
    if (!receipt || receipt.status === 0) {
        throw new Error(`Transaction ${txHash} failed`);
    }
    return receipt;
}

export function formatAmount(amount: bigint, decimals: number): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    
    return `${whole}.${fraction.toString().padStart(decimals, '0')}`;
}

export function parseAmount(amount: string, decimals: number): bigint {
    const [whole, fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole) * BigInt(10 ** decimals) + BigInt(paddedFraction);
}

export function isExpired(timelock: number): boolean {
    return Math.floor(Date.now() / 1000) >= timelock;
}

export function generateSwapId(): string {
    return `swap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}