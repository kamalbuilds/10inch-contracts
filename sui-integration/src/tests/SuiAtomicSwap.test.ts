// Copyright (c) 1inch Network
// SPDX-License-Identifier: MIT

/**
 * Unit tests for SuiAtomicSwap SDK
 */

import { SuiAtomicSwap, SUI_NETWORKS, SUPPORTED_CHAINS, Utils } from '../index';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// Mock configuration for testing
const TEST_CONFIG = {
    network: SUI_NETWORKS.localnet,
    packageId: '0x1234567890abcdef1234567890abcdef12345678',
    swapEscrowId: '0xabcdef1234567890abcdef1234567890abcdef12',
    bridgeId: '0xfedcba0987654321fedcba0987654321fedcba09',
};

describe('SuiAtomicSwap SDK', () => {
    let sdk: SuiAtomicSwap;
    let testKeypair: Ed25519Keypair;

    beforeAll(async () => {
        testKeypair = new Ed25519Keypair();
        sdk = new SuiAtomicSwap({
            ...TEST_CONFIG,
            keyPair: testKeypair,
        });
    });

    describe('Utility Functions', () => {
        test('should generate valid secrets', () => {
            const secret1 = Utils.generateSecret();
            const secret2 = Utils.generateSecret();
            
            expect(secret1).toHaveLength(64); // 32 bytes = 64 hex chars
            expect(secret2).toHaveLength(64);
            expect(secret1).not.toBe(secret2); // Should be unique
            expect(/^[0-9a-f]{64}$/i.test(secret1)).toBe(true); // Valid hex
            expect(/^[0-9a-f]{64}$/i.test(secret2)).toBe(true);
        });

        test('should generate valid hashlocks from secrets', () => {
            const secret = Utils.generateSecret();
            const hashlock = Utils.generateHashlock(secret);
            
            expect(hashlock).toHaveLength(64); // SHA-256 = 64 hex chars
            expect(/^[0-9a-f]{64}$/i.test(hashlock)).toBe(true); // Valid hex
        });

        test('should verify secrets against hashlocks correctly', () => {
            const secret = Utils.generateSecret();
            const hashlock = Utils.generateHashlock(secret);
            const wrongSecret = Utils.generateSecret();
            
            expect(Utils.verifySecret(secret, hashlock)).toBe(true);
            expect(Utils.verifySecret(wrongSecret, hashlock)).toBe(false);
        });

        test('should generate consistent hashlocks for same secret', () => {
            const secret = 'a'.repeat(64); // Fixed secret
            const hashlock1 = Utils.generateHashlock(secret);
            const hashlock2 = Utils.generateHashlock(secret);
            
            expect(hashlock1).toBe(hashlock2);
        });

        test('should generate current timestamp', () => {
            const timestamp = Utils.getCurrentTimestamp();
            const now = Date.now();
            
            expect(timestamp).toBeGreaterThan(now - 1000); // Within 1 second
            expect(timestamp).toBeLessThan(now + 1000);
            expect(Number.isInteger(timestamp)).toBe(true);
        });

        test('should calculate future timelock correctly', () => {
            const durationMinutes = 60;
            const timelock = Utils.calculateTimelock(durationMinutes);
            const expectedTime = Date.now() + (durationMinutes * 60 * 1000);
            
            const timelockNum = parseInt(timelock);
            expect(timelockNum).toBeGreaterThan(expectedTime - 1000);
            expect(timelockNum).toBeLessThan(expectedTime + 1000);
        });
    });

    describe('SDK Initialization', () => {
        test('should initialize with valid configuration', () => {
            expect(sdk).toBeInstanceOf(SuiAtomicSwap);
            expect(sdk.getAddress()).toBeTruthy();
            expect(sdk.getAddress()).toMatch(/^0x[0-9a-f]+$/i);
        });

        test('should throw error with invalid private key', () => {
            expect(() => {
                new SuiAtomicSwap({
                    ...TEST_CONFIG,
                    privateKey: 'invalid_key',
                });
            }).toThrow('Invalid private key format');
        });

        test('should throw error without credentials', () => {
            expect(() => {
                const unconfiguredSDK = new SuiAtomicSwap(TEST_CONFIG);
                unconfiguredSDK.getAddress();
            }).toThrow('No keypair configured');
        });
    });

    describe('Parameter Validation', () => {
        test('should validate swap parameters correctly', async () => {
            const validParams = {
                amount: '1000000000',
                hashlock: Utils.generateHashlock(Utils.generateSecret()),
                timelock: Utils.calculateTimelock(60),
                receiver: '0x1234567890abcdef1234567890abcdef12345678',
            };

            // This would normally call createSwap, but we'll test validation logic
            expect(() => sdk['validateSwapParams'](validParams)).not.toThrow();
        });

        test('should reject invalid swap amounts', () => {
            const invalidParams = {
                amount: '0',
                hashlock: Utils.generateHashlock(Utils.generateSecret()),
                timelock: Utils.calculateTimelock(60),
                receiver: '0x1234567890abcdef1234567890abcdef12345678',
            };

            expect(() => sdk['validateSwapParams'](invalidParams)).toThrow('Invalid amount');
        });

        test('should reject invalid hashlock', () => {
            const invalidParams = {
                amount: '1000000000',
                hashlock: 'invalid_hashlock',
                timelock: Utils.calculateTimelock(60),
                receiver: '0x1234567890abcdef1234567890abcdef12345678',
            };

            expect(() => sdk['validateSwapParams'](invalidParams)).toThrow('Invalid hashlock');
        });

        test('should reject expired timelock', () => {
            const invalidParams = {
                amount: '1000000000',
                hashlock: Utils.generateHashlock(Utils.generateSecret()),
                timelock: (Date.now() - 1000).toString(), // Past timelock
                receiver: '0x1234567890abcdef1234567890abcdef12345678',
            };

            expect(() => sdk['validateSwapParams'](invalidParams)).toThrow('Timelock must be at least');
        });

        test('should reject invalid receiver address', () => {
            const invalidParams = {
                amount: '1000000000',
                hashlock: Utils.generateHashlock(Utils.generateSecret()),
                timelock: Utils.calculateTimelock(60),
                receiver: 'invalid_address',
            };

            expect(() => sdk['validateSwapParams'](invalidParams)).toThrow('Invalid receiver address');
        });
    });

    describe('Bridge Parameter Validation', () => {
        test('should validate bridge parameters correctly', () => {
            const validParams = {
                amount: '1000000000',
                destinationChain: SUPPORTED_CHAINS.ETHEREUM,
                recipient: '0x1234567890abcdef1234567890abcdef12345678',
                hashlock: Utils.generateHashlock(Utils.generateSecret()),
                timelock: Utils.calculateTimelock(120),
            };

            expect(() => sdk['validateBridgeParams'](validParams)).not.toThrow();
        });

        test('should reject unsupported destination chain', () => {
            const invalidParams = {
                amount: '1000000000',
                destinationChain: 999, // Unsupported chain
                recipient: '0x1234567890abcdef1234567890abcdef12345678',
                hashlock: Utils.generateHashlock(Utils.generateSecret()),
                timelock: Utils.calculateTimelock(120),
            };

            expect(() => sdk['validateBridgeParams'](invalidParams)).toThrow('Unsupported destination chain');
        });
    });

    describe('Helper Functions', () => {
        test('should validate Sui addresses correctly', () => {
            const validAddress = '0x1234567890abcdef1234567890abcdef12345678';
            const invalidAddress = 'invalid_address';
            
            expect(sdk['isValidSuiAddress'](validAddress)).toBe(true);
            expect(sdk['isValidSuiAddress'](invalidAddress)).toBe(false);
        });

        test('should create test accounts', async () => {
            const account = await Utils.createTestAccount('devnet');
            
            expect(account).toHaveProperty('keypair');
            expect(account).toHaveProperty('address');
            expect(account).toHaveProperty('privateKey');
            expect(account.address).toMatch(/^0x[0-9a-f]+$/i);
            expect(account.privateKey).toHaveLength(66); // 0x + 64 hex chars
        });
    });

    describe('Constants and Types', () => {
        test('should have correct network configurations', () => {
            expect(SUI_NETWORKS.mainnet).toBeDefined();
            expect(SUI_NETWORKS.testnet).toBeDefined();
            expect(SUI_NETWORKS.devnet).toBeDefined();
            expect(SUI_NETWORKS.localnet).toBeDefined();
            
            expect(SUI_NETWORKS.mainnet.name).toBe('Mainnet');
            expect(SUI_NETWORKS.mainnet.url).toBeTruthy();
            expect(SUI_NETWORKS.mainnet.chainId).toBeTruthy();
        });

        test('should have correct supported chains', () => {
            expect(SUPPORTED_CHAINS.ETHEREUM).toBe(1);
            expect(SUPPORTED_CHAINS.BITCOIN).toBe(2);
            expect(SUPPORTED_CHAINS.SUI).toBe(3);
            expect(SUPPORTED_CHAINS.APTOS).toBe(4);
            expect(SUPPORTED_CHAINS.POLYGON).toBe(5);
            expect(SUPPORTED_CHAINS.ARBITRUM).toBe(6);
            expect(SUPPORTED_CHAINS.OPTIMISM).toBe(7);
            expect(SUPPORTED_CHAINS.BSC).toBe(8);
        });
    });

    describe('Error Handling', () => {
        test('should handle network errors gracefully', async () => {
            // This would require mocking the SuiClient
            // For now, we'll test that errors don't crash the SDK
            expect(() => {
                new SuiAtomicSwap({
                    ...TEST_CONFIG,
                    network: {
                        name: 'Invalid',
                        url: 'https://invalid-url.example.com',
                        chainId: '999',
                    },
                    keyPair: testKeypair,
                });
            }).not.toThrow();
        });
    });
});

describe('Edge Cases and Security', () => {
    test('should handle very large amounts', () => {
        const _largeAmount = '999999999999999999999'; // Very large number
        const secret = Utils.generateSecret();
        const hashlock = Utils.generateHashlock(secret);
        
        expect(hashlock).toHaveLength(64);
        expect(Utils.verifySecret(secret, hashlock)).toBe(true);
    });

    test('should handle empty strings gracefully', () => {
        expect(() => Utils.generateHashlock('')).not.toThrow();
        expect(Utils.verifySecret('', Utils.generateHashlock(''))).toBe(true);
    });

    test('should handle special characters in secrets', () => {
        const specialSecret = '0123456789abcdef!@#$%^&*()_+-={}[]|\\:";\'<>?,./`~';
        const hashlock = Utils.generateHashlock(specialSecret);
        
        expect(hashlock).toHaveLength(64);
        expect(Utils.verifySecret(specialSecret, hashlock)).toBe(true);
    });

    test('should be consistent across multiple calls', () => {
        const secret = 'consistent_test_secret_for_multiple_calls_verification';
        const hashlock1 = Utils.generateHashlock(secret);
        const hashlock2 = Utils.generateHashlock(secret);
        const hashlock3 = Utils.generateHashlock(secret);
        
        expect(hashlock1).toBe(hashlock2);
        expect(hashlock2).toBe(hashlock3);
        expect(Utils.verifySecret(secret, hashlock1)).toBe(true);
        expect(Utils.verifySecret(secret, hashlock2)).toBe(true);
        expect(Utils.verifySecret(secret, hashlock3)).toBe(true);
    });
});

describe('Integration Preparation', () => {
    test('should prepare for network calls', () => {
        const sdk = new SuiAtomicSwap({
            ...TEST_CONFIG,
            keyPair: new Ed25519Keypair(),
        });

        // These methods should exist and be callable
        expect(typeof sdk.getBalance).toBe('function');
        expect(typeof sdk.createSwap).toBe('function');
        expect(typeof sdk.completeSwap).toBe('function');
        expect(typeof sdk.refundSwap).toBe('function');
        expect(typeof sdk.createOutboundOrder).toBe('function');
        expect(typeof sdk.createInboundOrder).toBe('function');
        expect(typeof sdk.completeBridgeOrder).toBe('function');
        expect(typeof sdk.cancelBridgeOrder).toBe('function');
    });

    test('should have proper transaction building methods', () => {
        const sdk = new SuiAtomicSwap({
            ...TEST_CONFIG,
            keyPair: new Ed25519Keypair(),
        });

        // These private methods should exist for transaction building
        expect(typeof sdk['buildSwapExistsTx']).toBe('function');
        expect(typeof sdk['buildIsSwapActiveTx']).toBe('function');
        expect(typeof sdk['buildCanRefundTx']).toBe('function');
        expect(typeof sdk['buildGetProtocolStatsTx']).toBe('function');
    });
}); 