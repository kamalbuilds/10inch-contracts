import { createHash } from 'crypto';

export function generateSecret(length: number = 32): string {
  const chars = '0123456789abcdef';
  let secret = '';
  for (let i = 0; i < length; i++) {
    secret += chars[Math.floor(Math.random() * chars.length)];
  }
  return secret;
}

export function generateHashlock(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function verifySecret(secret: string, hashlock: string): boolean {
  const computedHash = generateHashlock(secret);
  return computedHash === hashlock;
}

export function calculateTimelock(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}

export function isTimelockExpired(timelock: number | string): boolean {
  const timelockNum = typeof timelock === 'string' ? parseInt(timelock) : timelock;
  return Math.floor(Date.now() / 1000) >= timelockNum;
}

export function formatAmount(amount: string, decimals: number = 6): string {
  const value = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  
  if (remainder === BigInt(0)) {
    return whole.toString();
  }
  
  const remainderStr = remainder.toString().padStart(decimals, '0');
  const trimmed = remainderStr.replace(/0+$/, '');
  return `${whole}.${trimmed}`;
}

export function parseAmount(amount: string, decimals: number = 6): string {
  if (!amount.includes('.')) {
    return (BigInt(amount) * BigInt(10 ** decimals)).toString();
  }
  
  const [whole, fraction] = amount.split('.');
  const fractionPadded = fraction.padEnd(decimals, '0').slice(0, decimals);
  const wholeBigInt = BigInt(whole) * BigInt(10 ** decimals);
  const fractionBigInt = BigInt(fractionPadded);
  
  return (wholeBigInt + fractionBigInt).toString();
}

export function validateCosmosAddress(address: string, prefix: string): boolean {
  try {
    // Basic validation - starts with prefix and has correct length
    if (!address.startsWith(prefix)) {
      return false;
    }
    
    // Cosmos addresses are typically 39-47 characters (varies by chain)
    if (address.length < 39 || address.length > 47) {
      return false;
    }
    
    // Check if it contains only valid bech32 characters
    const validChars = /^[a-z0-9]+$/;
    const addressWithoutPrefix = address.slice(prefix.length);
    return validChars.test(addressWithoutPrefix);
  } catch {
    return false;
  }
}

export function validateEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isValidSecretHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

export const MIN_TIMELOCK_DURATION = 3600; // 1 hour
export const MAX_TIMELOCK_DURATION = 86400; // 24 hours
export const DEFAULT_TIMELOCK_DURATION = 7200; // 2 hours

export function validateTimelock(seconds: number): void {
  if (seconds < MIN_TIMELOCK_DURATION) {
    throw new Error(`Timelock must be at least ${MIN_TIMELOCK_DURATION} seconds`);
  }
  if (seconds > MAX_TIMELOCK_DURATION) {
    throw new Error(`Timelock must not exceed ${MAX_TIMELOCK_DURATION} seconds`);
  }
}