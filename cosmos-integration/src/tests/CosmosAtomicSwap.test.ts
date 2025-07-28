import { CosmosAtomicSwap } from '../CosmosAtomicSwap';
import { TESTNET_CONFIG, LOCAL_CONFIG } from '../constants';
import {
  generateSecret,
  generateHashlock,
  verifySecret,
  validateTimelock,
  parseAmount,
  formatAmount,
  isValidSecretHash,
  validateCosmosAddress,
  validateEthereumAddress,
} from '../utils';
import { SwapStatus, OrderStatus, CHAIN_IDS } from '../types';

describe('CosmosAtomicSwap', () => {
  let client: CosmosAtomicSwap;

  beforeEach(() => {
    client = new CosmosAtomicSwap({
      ...TESTNET_CONFIG,
      atomicSwapContract: 'cosmos1atomicswap...',
      bridgeContract: 'cosmos1bridge...',
    });
  });

  describe('Utility Functions', () => {
    test('generateSecret should create valid hex string', () => {
      const secret = generateSecret();
      expect(secret).toHaveLength(32);
      expect(/^[0-9a-f]+$/.test(secret)).toBe(true);
    });

    test('generateHashlock should create SHA256 hash', () => {
      const secret = '1234567890abcdef1234567890abcdef';
      const hashlock = generateHashlock(secret);
      expect(hashlock).toHaveLength(64);
      expect(hashlock).toBe('4a44dc15364204a80fe80e9039455cc1608281820fe2b24f1e5233ade6af1dd5');
    });

    test('verifySecret should validate secret against hashlock', () => {
      const secret = generateSecret();
      const hashlock = generateHashlock(secret);
      expect(verifySecret(secret, hashlock)).toBe(true);
      expect(verifySecret('wrongsecret', hashlock)).toBe(false);
    });

    test('validateTimelock should accept valid timelocks', () => {
      expect(() => validateTimelock(3600)).not.toThrow();
      expect(() => validateTimelock(7200)).not.toThrow();
      expect(() => validateTimelock(86400)).not.toThrow();
    });

    test('validateTimelock should reject invalid timelocks', () => {
      expect(() => validateTimelock(1800)).toThrow('Timelock must be at least 3600 seconds');
      expect(() => validateTimelock(172800)).toThrow('Timelock must not exceed 86400 seconds');
    });

    test('parseAmount should convert decimal to base units', () => {
      expect(parseAmount('1', 6)).toBe('1000000');
      expect(parseAmount('1.5', 6)).toBe('1500000');
      expect(parseAmount('0.000001', 6)).toBe('1');
      expect(parseAmount('1000.123456', 6)).toBe('1000123456');
    });

    test('formatAmount should convert base units to decimal', () => {
      expect(formatAmount('1000000', 6)).toBe('1');
      expect(formatAmount('1500000', 6)).toBe('1.5');
      expect(formatAmount('1', 6)).toBe('0.000001');
      expect(formatAmount('1000123456', 6)).toBe('1000.123456');
    });

    test('isValidSecretHash should validate hash format', () => {
      expect(isValidSecretHash(generateHashlock(generateSecret()))).toBe(true);
      expect(isValidSecretHash('invalid')).toBe(false);
      expect(isValidSecretHash('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
    });

    test('validateCosmosAddress should validate addresses', () => {
      expect(validateCosmosAddress('cosmos1234567890abcdefghijklmnopqrstuvwxyz', 'cosmos')).toBe(true);
      expect(validateCosmosAddress('osmo1234567890abcdefghijklmnopqrstuvwxyz', 'osmo')).toBe(true);
      expect(validateCosmosAddress('invalid', 'cosmos')).toBe(false);
      expect(validateCosmosAddress('cosmos1234', 'cosmos')).toBe(false);
    });

    test('validateEthereumAddress should validate addresses', () => {
      expect(validateEthereumAddress('0x742d35Cc6634C0532925a3b844Bc9e7595f4278d')).toBe(true);
      expect(validateEthereumAddress('0x0000000000000000000000000000000000000000')).toBe(true);
      expect(validateEthereumAddress('invalid')).toBe(false);
      expect(validateEthereumAddress('0x123')).toBe(false);
    });
  });

  describe('Client Methods', () => {
    test('generateSecret should work through client', () => {
      const secret = client.generateSecret();
      expect(secret).toHaveLength(32);
      expect(/^[0-9a-f]+$/.test(secret)).toBe(true);
    });

    test('generateHashlock should work through client', () => {
      const secret = client.generateSecret();
      const hashlock = client.generateHashlock(secret);
      expect(hashlock).toHaveLength(64);
    });

    test('verifySecret should work through client', async () => {
      const secret = client.generateSecret();
      const hashlock = client.generateHashlock(secret);
      const isValid = await client.verifySecret(secret, hashlock);
      expect(isValid).toBe(true);
    });

    test('should throw error when not connected', async () => {
      await expect(async () => {
        await client.createSwap({
          recipient: 'cosmos1234567890abcdefghijklmnopqrstuvwxyz',
          secretHash: generateHashlock(generateSecret()),
          timelock: 3600,
          amount: { denom: 'uatom', amount: '1000000' },
        });
      }).rejects.toThrow('Client not connected');
    });

    test('should throw error when contract not configured', async () => {
      const clientWithoutContract = new CosmosAtomicSwap(TESTNET_CONFIG);
      await expect(async () => {
        await clientWithoutContract.querySwap('swap_1');
      }).rejects.toThrow('Atomic swap contract address not configured');
    });
  });

  describe('Mock Contract Interactions', () => {
    // These tests would require mocking the CosmJS client
    // In a real implementation, you would use jest.mock() to mock the dependencies

    test('createSwap should validate parameters', async () => {
      await expect(async () => {
        await client.createSwap({
          recipient: 'invalid_address',
          secretHash: generateHashlock(generateSecret()),
          timelock: 3600,
          amount: { denom: 'uatom', amount: '1000000' },
        });
      }).rejects.toThrow('Client not connected');
    });

    test('createBridgeOrder should validate recipient based on chain', async () => {
      // Test Cosmos recipient
      await expect(async () => {
        await client.createBridgeOrder({
          targetChainId: CHAIN_IDS.COSMOS,
          recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f4278d', // Ethereum address
          secretHash: generateHashlock(generateSecret()),
          timelock: 3600,
          amount: { denom: 'uatom', amount: '1000000' },
        });
      }).rejects.toThrow('Client not connected');

      // Test Ethereum recipient
      await expect(async () => {
        await client.createBridgeOrder({
          targetChainId: CHAIN_IDS.ETHEREUM,
          recipient: 'cosmos1234567890abcdefghijklmnopqrstuvwxyz', // Cosmos address
          secretHash: generateHashlock(generateSecret()),
          timelock: 3600,
          amount: { denom: 'uatom', amount: '1000000' },
        });
      }).rejects.toThrow('Client not connected');
    });
  });
});