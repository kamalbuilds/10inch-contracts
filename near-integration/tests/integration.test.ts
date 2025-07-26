import { Worker, NearAccount } from 'near-workspaces';
const { NEAR } = require('near-workspaces');
import { ethers } from 'ethers';
import path from 'path';
import { NearFusionClient } from '../src/fusion-client';
import crypto from 'crypto';

describe('NEAR Fusion+ Integration Tests', () => {
  let worker: Worker;
  let root: NearAccount;
  let htlcContract: NearAccount;
  let alice: NearAccount;
  let bob: NearAccount;

  beforeAll(async () => {
    worker = await Worker.init();
    root = worker.rootAccount;

    // Deploy HTLC contract
    htlcContract = await root.createSubAccount('htlc-contract');
    await htlcContract.deploy(
      path.join(__dirname, '../target/wasm32-unknown-unknown/release/fusion_htlc_near.wasm')
    );
    await htlcContract.call(htlcContract, 'new', {});

    // Create test accounts
    alice = await root.createSubAccount('alice');
    bob = await root.createSubAccount('bob');

    // Fund accounts
    await alice.updateAccount({
      amount: NEAR.parse('100').toBigInt(),
    });
    await bob.updateAccount({
      amount: NEAR.parse('100').toBigInt(),
    });
  });

  afterAll(async () => {
    await worker.tearDown();
  });

  describe('Basic HTLC Operations', () => {
    test('should create and withdraw HTLC with valid secret', async () => {
      // Generate secret and hash
      const secret = 'my_test_secret_value';
      const secretBytes = Buffer.from(secret);
      const hashlock = crypto.createHash('sha256').update(secretBytes).digest('hex');

      // Create HTLC
      const createResult = await alice.call(
        htlcContract,
        'create_htlc',
        {
          receiver: bob.accountId,
          hashlock,
          timelock_seconds: 3600, // 1 hour
        },
        {
          attachedDeposit: NEAR.parse('1').toString(),
          gas: BigInt('100000000000000'),
        }
      );

      const htlcId = createResult as string;
      expect(htlcId).toMatch(/^htlc_\d+$/);

      // Check HTLC details
      const htlc = await htlcContract.view('get_htlc', { htlc_id: htlcId }) as any;
      expect(htlc.sender).toBe(alice.accountId);
      expect(htlc.receiver).toBe(bob.accountId);
      expect(htlc.amount).toBe(NEAR.parse('1').toString());
      expect(htlc.hashlock).toBe(hashlock);
      expect(htlc.withdrawn).toBe(false);
      expect(htlc.refunded).toBe(false);

      // Withdraw with secret
      const withdrawResult = await bob.call(
        htlcContract,
        'withdraw',
        {
          htlc_id: htlcId,
          secret: Buffer.from(secretBytes).toString('hex'),
        }
      );

      // Verify withdrawal
      const htlcAfter = await htlcContract.view('get_htlc', { htlc_id: htlcId }) as any;
      expect(htlcAfter.withdrawn).toBe(true);
      expect(htlcAfter.secret).toBe(Buffer.from(secretBytes).toString('hex'));
    });

    test('should refund HTLC after timeout', async () => {
      const hashlock = crypto.randomBytes(32).toString('hex');

      // Create HTLC with short timeout
      const createResult = await alice.call(
        htlcContract,
        'create_htlc',
        {
          receiver: bob.accountId,
          hashlock,
          timelock_seconds: 1, // 1 second (minimum in test)
        },
        {
          attachedDeposit: NEAR.parse('1').toString(),
        }
      );

      const htlcId = createResult as string;

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Refund
      await alice.call(htlcContract, 'refund', { htlc_id: htlcId });

      // Verify refund
      const htlcAfter = await htlcContract.view('get_htlc', { htlc_id: htlcId }) as any;
      expect(htlcAfter.refunded).toBe(true);
    });

    test('should reject withdrawal with invalid secret', async () => {
      const secret = 'correct_secret';
      const hashlock = crypto.createHash('sha256')
        .update(Buffer.from(secret))
        .digest('hex');

      // Create HTLC
      const createResult = await alice.call(
        htlcContract,
        'create_htlc',
        {
          receiver: bob.accountId,
          hashlock,
          timelock_seconds: 3600,
        },
        {
          attachedDeposit: NEAR.parse('1').toString(),
        }
      );

      const htlcId = createResult as string;

      // Try to withdraw with wrong secret
      await expect(
        bob.call(htlcContract, 'withdraw', {
          htlc_id: htlcId,
          secret: Buffer.from('wrong_secret').toString('hex'),
        })
      ).rejects.toThrow('Invalid secret');
    });
  });

  describe('Partial Fills', () => {
    test('should create HTLC with partial fills enabled', async () => {
      const hashlock = crypto.randomBytes(32).toString('hex');

      const createResult = await alice.call(
        htlcContract,
        'create_htlc_partial',
        {
          receiver: bob.accountId,
          hashlock,
          timelock_seconds: 3600,
          allow_partial_fills: true,
          min_fill_amount: NEAR.parse('0.1').toString(),
        },
        {
          attachedDeposit: NEAR.parse('10').toString(),
        }
      );

      const htlcId = createResult as string;

      const htlc = await htlcContract.view('get_htlc_partial', { htlc_id: htlcId }) as any;
      expect(htlc.allow_partial_fills).toBe(true);
      expect(htlc.total_amount).toBe(NEAR.parse('10').toString());
      expect(htlc.remaining_amount).toBe(NEAR.parse('10').toString());
      expect(htlc.min_fill_amount).toBe(NEAR.parse('0.1').toString());
    });

    test('should create and claim partial fills', async () => {
      const secret = 'partial_fill_secret';
      const hashlock = crypto.createHash('sha256')
        .update(Buffer.from(secret))
        .digest('hex');

      // Create HTLC with partial fills
      const htlcResult = await alice.call(
        htlcContract,
        'create_htlc_partial',
        {
          receiver: bob.accountId,
          hashlock,
          timelock_seconds: 3600,
          allow_partial_fills: true,
          min_fill_amount: NEAR.parse('1').toString(),
        },
        {
          attachedDeposit: NEAR.parse('10').toString(),
        }
      );

      const htlcId = htlcResult as string;

      // Create partial fill
      const charlie = await root.createSubAccount('charlie');
      await charlie.updateAccount({
        amount: NEAR.parse('10').toBigInt(),
      });

      const fillResult = await charlie.call(
        htlcContract,
        'create_partial_fill',
        {
          htlc_id: htlcId,
          fill_amount: NEAR.parse('3').toString(),
        },
        {
          attachedDeposit: NEAR.parse('3').toString(),
        }
      );

      const fillId = fillResult as string;
      expect(fillId).toMatch(/^fill_\d+$/);

      // Check fill details
      const fill = await htlcContract.view('get_partial_fill', { fill_id: fillId }) as any;
      expect(fill.htlc_id).toBe(htlcId);
      expect(fill.filler).toBe(charlie.accountId);
      expect(fill.amount).toBe(NEAR.parse('3').toString());
      expect(fill.claimed).toBe(false);

      // Claim partial fill with secret
      await bob.call(htlcContract, 'withdraw_partial_fill', {
        fill_id: fillId,
        secret: Buffer.from(secret).toString('hex'),
      });

      // Verify claim
      const fillAfter = await htlcContract.view('get_partial_fill', { fill_id: fillId }) as any;
      expect(fillAfter.claimed).toBe(true);
      expect(fillAfter.secret).toBe(Buffer.from(secret).toString('hex'));
    });
  });

  describe('Cross-Chain Integration', () => {
    test('should handle NEAR to EVM swap flow', async () => {
      const client = new NearFusionClient();
      await client.initialize({
        nearNetwork: 'testnet',
        evmRpcUrls: {
          ethereum: 'https://sepolia.infura.io/v3/test',
        },
      });

      // Mock the swap creation
      const swapParams = {
        direction: 'NEAR_TO_EVM' as const,
        srcChain: 'NEAR',
        dstChain: 'ethereum',
        srcToken: 'NEAR',
        dstToken: ethers.ZeroAddress,
        amount: '1',
        sender: alice.accountId,
        receiver: '0x742d35Cc6634C0532925a3b844Bc9e7595f6E789',
      };

      // Test fee estimation
      const fees = await client.estimateFee(swapParams);
      expect(fees.protocolFee).toBeDefined();
      expect(fees.networkFee).toBeDefined();
      expect(BigInt(fees.totalFee)).toBeGreaterThan(0n);
    });

    test('should verify supported tokens', async () => {
      const client = new NearFusionClient();
      await client.initialize({
        nearNetwork: 'testnet',
        evmRpcUrls: {},
      });

      const nearTokens = await client.getSupportedTokens('NEAR');
      expect(nearTokens).toContainEqual(
        expect.objectContaining({
          address: 'NEAR',
          symbol: 'NEAR',
          decimals: 24,
        })
      );

      const ethTokens = await client.getSupportedTokens('ethereum');
      expect(ethTokens).toContainEqual(
        expect.objectContaining({
          address: ethers.ZeroAddress,
          symbol: 'ETH',
          decimals: 18,
        })
      );
    });
  });

  describe('Safety Deposits', () => {
    test('should create and claim safety deposit', async () => {
      const hashlock = crypto.randomBytes(32).toString('hex');

      // Create HTLC
      const htlcResult = await alice.call(
        htlcContract,
        'create_htlc',
        {
          receiver: bob.accountId,
          hashlock,
          timelock_seconds: 3600,
        },
        {
          attachedDeposit: NEAR.parse('5').toString(),
        }
      );

      const htlcId = htlcResult as string;

      // Resolver creates safety deposit
      const resolver = await root.createSubAccount('resolver');
      await resolver.updateAccount({
        amount: NEAR.parse('10').toBigInt(),
      });

      const depositResult = await resolver.call(
        htlcContract,
        'create_safety_deposit',
        {
          htlc_id: htlcId,
        },
        {
          attachedDeposit: NEAR.parse('0.5').toString(),
        }
      );

      const depositId = depositResult as string;
      expect(depositId).toMatch(/^deposit_\d+$/);

      // Claim safety deposit
      await resolver.call(htlcContract, 'claim_safety_deposit', {
        deposit_id: depositId,
      });

      // Verify deposit removed
      const deposit = await htlcContract.view('get_safety_deposit', {
        deposit_id: depositId,
      });
      expect(deposit).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    test('should handle zero amount HTLC creation', async () => {
      await expect(
        alice.call(
          htlcContract,
          'create_htlc',
          {
            receiver: bob.accountId,
            hashlock: crypto.randomBytes(32).toString('hex'),
            timelock_seconds: 3600,
          },
          {
            attachedDeposit: BigInt('0'),
          }
        )
      ).rejects.toThrow('Amount must be greater than 0');
    });

    test('should handle invalid hashlock length', async () => {
      await expect(
        alice.call(
          htlcContract,
          'create_htlc',
          {
            receiver: bob.accountId,
            hashlock: 'short_hash',
            timelock_seconds: 3600,
          },
          {
            attachedDeposit: NEAR.parse('1').toString(),
          }
        )
      ).rejects.toThrow('Invalid hashlock length');
    });

    test('should prevent double withdrawal', async () => {
      const secret = 'test_secret';
      const hashlock = crypto.createHash('sha256')
        .update(Buffer.from(secret))
        .digest('hex');

      // Create and withdraw HTLC
      const htlcResult = await alice.call(
        htlcContract,
        'create_htlc',
        {
          receiver: bob.accountId,
          hashlock,
          timelock_seconds: 3600,
        },
        {
          attachedDeposit: NEAR.parse('1').toString(),
        }
      );

      const htlcId = htlcResult as string;

      // First withdrawal
      await bob.call(htlcContract, 'withdraw', {
        htlc_id: htlcId,
        secret: Buffer.from(secret).toString('hex'),
      });

      // Second withdrawal should fail
      await expect(
        bob.call(htlcContract, 'withdraw', {
          htlc_id: htlcId,
          secret: Buffer.from(secret).toString('hex'),
        })
      ).rejects.toThrow('Already withdrawn');
    });
  });
});