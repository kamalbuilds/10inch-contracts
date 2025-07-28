// Copyright (c) 1inch Network
// SPDX-License-Identifier: MIT

/**
 * Integration tests for SuiAtomicSwap SDK
 * These tests would run against actual Sui networks in a real environment
 */

import { SuiAtomicSwap, SUI_NETWORKS, SUPPORTED_CHAINS, Utils } from '../index';

// Test configuration for integration tests
const INTEGRATION_CONFIG = {
    network: SUI_NETWORKS.devnet,
    // These should be real deployed contract addresses in actual tests
    packageId: '0x1234567890abcdef1234567890abcdef12345678',
    swapEscrowId: '0xabcdef1234567890abcdef1234567890abcdef12',
    bridgeId: '0xfedcba0987654321fedcba0987654321fedcba09',
};

describe('Integration Tests (Network Dependent)', () => {
    // These tests would require actual network connectivity and deployed contracts
    // They are skipped in the default test suite but can be run separately

    describe.skip('Real Network Tests', () => {
        let sdk: SuiAtomicSwap;

        beforeAll(async () => {
            // Create test account
            const testAccount = await Utils.createTestAccount('devnet');
            
            sdk = new SuiAtomicSwap({
                ...INTEGRATION_CONFIG,
                keyPair: testAccount.keypair,
            });
        });

        test('should connect to Sui devnet', async () => {
            const balance = await sdk.getBalance();
            expect(typeof balance).toBe('string');
            expect(Number(balance)).toBeGreaterThanOrEqual(0);
        });

        test('should create and complete atomic swap end-to-end', async () => {
            // This would be a full end-to-end test
            const secret = Utils.generateSecret();
            const hashlock = Utils.generateHashlock(secret);
            const timelock = Utils.calculateTimelock(60);
            const amount = '1000000'; // Small amount for testing

            // Create second account for the swap
            const recipient = await Utils.createTestAccount('devnet');

            // Create swap
            const swapResult = await sdk.createSwap({
                amount,
                hashlock,
                timelock,
                receiver: recipient.address,
            });

            expect(swapResult.swapId).toBeTruthy();
            expect(swapResult.transactionDigest).toBeTruthy();

            // Initialize SDK for recipient
            const recipientSDK = new SuiAtomicSwap({
                ...INTEGRATION_CONFIG,
                keyPair: recipient.keypair,
            });

            // Complete swap
            const completeResult = await recipientSDK.completeSwap({
                swapObjectId: swapResult.swapId,
                secret,
            });

            expect(completeResult.secret).toBe(secret);
            expect(completeResult.transactionDigest).toBeTruthy();
        });

        test('should create and complete bridge order end-to-end', async () => {
            const secret = Utils.generateSecret();
            const hashlock = Utils.generateHashlock(secret);
            const timelock = Utils.calculateTimelock(120);
            const amount = '2000000'; // Small amount for testing

            // Create recipient account
            const recipient = await Utils.createTestAccount('devnet');

            // Create outbound bridge order
            const bridgeResult = await sdk.createOutboundOrder({
                amount,
                destinationChain: SUPPORTED_CHAINS.ETHEREUM,
                recipient: recipient.address,
                hashlock,
                timelock,
            });

            expect(bridgeResult.orderId).toBeTruthy();
            expect(bridgeResult.transactionDigest).toBeTruthy();

            // Check bridge order state
            const bridgeOrder = await sdk.getBridgeOrder(bridgeResult.orderId);
            expect(bridgeOrder).toBeTruthy();
            if (bridgeOrder) {
                expect(bridgeOrder.order_id).toBe(bridgeResult.orderId);
                expect(bridgeOrder.state).toBe(0); // Pending
            }
        });

        test('should get protocol statistics', async () => {
            const stats = await sdk.getProtocolStats();
            
            expect(stats).toHaveProperty('swap_count');
            expect(stats).toHaveProperty('total_volume');
            expect(stats).toHaveProperty('protocol_fees_collected');
            expect(stats).toHaveProperty('fee_rate');
            expect(stats).toHaveProperty('is_paused');
            
            expect(typeof stats.swap_count).toBe('string');
            expect(typeof stats.total_volume).toBe('string');
            expect(typeof stats.is_paused).toBe('boolean');
        });

        test('should check chain support', async () => {
            for (const [, chainId] of Object.entries(SUPPORTED_CHAINS)) {
                const isSupported = await sdk.isChainSupported(chainId);
                expect(typeof isSupported).toBe('boolean');
                
                // Sui should always be supported
                if (chainId === SUPPORTED_CHAINS.SUI) {
                    expect(isSupported).toBe(true);
                }
            }
        });

        test('should calculate bridge fees correctly', async () => {
            const amount = '1000000000'; // 1 SUI
            
            for (const [chainName, chainId] of Object.entries(SUPPORTED_CHAINS)) {
                if (chainId !== SUPPORTED_CHAINS.SUI) {
                    try {
                        const fee = await sdk.calculateBridgeFee(amount, chainId);
                        expect(typeof fee).toBe('string');
                        expect(Number(fee)).toBeGreaterThanOrEqual(0);
                        expect(Number(fee)).toBeLessThan(Number(amount)); // Fee should be less than amount
                    } catch (error) {
                        // Some chains might not be supported in test environment
                        console.warn(`Could not calculate fee for ${chainName}: ${error}`);
                    }
                }
            }
        });
    });

    describe('Mock Network Tests', () => {
        test('should handle utility functions without network', () => {
            const secret = Utils.generateSecret();
            const hashlock = Utils.generateHashlock(secret);
            
            expect(secret).toHaveLength(64);
            expect(hashlock).toHaveLength(64);
            expect(Utils.verifySecret(secret, hashlock)).toBe(true);
        });

        test('should create test accounts', async () => {
            const account = await Utils.createTestAccount('devnet');
            
            expect(account).toHaveProperty('keypair');
            expect(account).toHaveProperty('address');
            expect(account).toHaveProperty('privateKey');
            expect(account.address).toMatch(/^0x[0-9a-f]+$/i);
        });

        test('should calculate timelock correctly', () => {
            const start = Date.now();
            const timelock = Utils.calculateTimelock(30); // 30 minutes
            const end = Date.now() + (30 * 60 * 1000);
            
            const timelockNum = parseInt(timelock);
            expect(timelockNum).toBeGreaterThan(start + (29 * 60 * 1000));
            expect(timelockNum).toBeLessThan(end + 1000);
        });

        test('should validate network configurations', () => {
            Object.values(SUI_NETWORKS).forEach(network => {
                expect(network).toHaveProperty('name');
                expect(network).toHaveProperty('url');
                expect(network).toHaveProperty('chainId');
                expect(typeof network.name).toBe('string');
                expect(typeof network.url).toBe('string');
                expect(typeof network.chainId).toBe('string');
                expect(network.url).toMatch(/^https?:\/\//);
            });
        });

        test('should validate supported chains', () => {
            const chainValues = Object.values(SUPPORTED_CHAINS);
            const uniqueValues = new Set(chainValues);
            
            // All chain IDs should be unique
            expect(uniqueValues.size).toBe(chainValues.length);
            
            // All chain IDs should be positive integers
            chainValues.forEach(chainId => {
                expect(Number.isInteger(chainId)).toBe(true);
                expect(chainId).toBeGreaterThan(0);
            });
        });
    });

    describe('Error Handling Tests', () => {
        test('should handle invalid configuration gracefully', () => {
            expect(() => {
                new SuiAtomicSwap({
                    network: {
                        name: 'Invalid',
                        url: 'invalid-url',
                        chainId: '999',
                    },
                    packageId: 'invalid',
                    swapEscrowId: 'invalid',
                    bridgeId: 'invalid',
                });
            }).not.toThrow();
        });

        test('should handle network timeouts gracefully', async () => {
            const sdk = new SuiAtomicSwap({
                network: {
                    name: 'Timeout Test',
                    url: 'https://httpstat.us/408', // Returns 408 timeout
                    chainId: '999',
                },
                packageId: '0x1234567890abcdef1234567890abcdef12345678',
                swapEscrowId: '0xabcdef1234567890abcdef1234567890abcdef12',
                bridgeId: '0xfedcba0987654321fedcba0987654321fedcba09',
                privateKey: '0x' + 'a'.repeat(64),
            });

            // These should handle network errors gracefully
            await expect(sdk.getBalance()).rejects.toThrow();
        });
    });

    describe('Performance Tests', () => {
        test('should generate secrets quickly', () => {
        const start = Date.now();
        const secrets: string[] = [];
        
        for (let i = 0; i < 1000; i++) {
            secrets.push(Utils.generateSecret());
        }
            
            const end = Date.now();
            const duration = end - start;
            
            expect(duration).toBeLessThan(1000); // Should take less than 1 second
            expect(secrets.length).toBe(1000);
            
            // All secrets should be unique
            const uniqueSecrets = new Set(secrets);
            expect(uniqueSecrets.size).toBe(1000);
        });

        test('should generate hashlocks quickly', () => {
            const secret = Utils.generateSecret();
            const start = Date.now();
            
            for (let i = 0; i < 1000; i++) {
                Utils.generateHashlock(secret + i.toString());
            }
            
            const end = Date.now();
            const duration = end - start;
            
            expect(duration).toBeLessThan(1000); // Should take less than 1 second
        });
    });
});

describe('SDK Compatibility Tests', () => {
    test('should work with different import styles', () => {
        // Default import
        expect(SuiAtomicSwap).toBeDefined();
        expect(typeof SuiAtomicSwap).toBe('function');
        
        // Named imports
        expect(SUI_NETWORKS).toBeDefined();
        expect(SUPPORTED_CHAINS).toBeDefined();
        expect(Utils).toBeDefined();
        
        expect(typeof SUI_NETWORKS).toBe('object');
        expect(typeof SUPPORTED_CHAINS).toBe('object');
        expect(typeof Utils).toBe('object');
    });

    test('should have consistent API surface', () => {
        const requiredMethods = [
            'generateSecret',
            'generateHashlock',
            'verifySecret',
            'getCurrentTimestamp',
            'calculateTimelock',
            'createTestAccount',
        ];

        requiredMethods.forEach(method => {
            expect(Utils).toHaveProperty(method);
            expect(typeof (Utils as any)[method]).toBe('function');
        });
    });

    test('should maintain backward compatibility', () => {
        // Test that constants haven't changed
        expect(SUPPORTED_CHAINS.ETHEREUM).toBe(1);
        expect(SUPPORTED_CHAINS.BITCOIN).toBe(2);
        expect(SUPPORTED_CHAINS.SUI).toBe(3);
        
        // Test that network names are consistent
        expect(SUI_NETWORKS.mainnet.name).toBe('Mainnet');
        expect(SUI_NETWORKS.testnet.name).toBe('Testnet');
        expect(SUI_NETWORKS.devnet.name).toBe('Devnet');
    });
}); 