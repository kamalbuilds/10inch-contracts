import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano, beginCell, Address } from '@ton/core';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { sha256 } from '@ton/crypto';

describe('FusionHTLC', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('FusionHTLC');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let fusionHTLC: SandboxContract<FusionHTLC>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        fusionHTLC = blockchain.openContract(
            FusionHTLC.createFromConfig(
                {
                    id: 0,
                    code,
                    data: beginCell().endCell(),
                },
                code
            )
        );

        deployer = await blockchain.treasury('deployer');

        const deployResult = await fusionHTLC.sendDeploy(
            deployer.getSender(),
            toNano('0.05')
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: fusionHTLC.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and fusionHTLC are ready to use
    });

    it('should create HTLC', async () => {
        const sender = await blockchain.treasury('sender');
        const receiver = await blockchain.treasury('receiver');
        
        // Generate secret and hashlock
        const { secret, hashlock } = await FusionHTLC.generateSecret();
        const timelock = FusionHTLC.calculateTimelock(3600); // 1 hour
        const amount = toNano('1');

        // Create HTLC
        const createResult = await fusionHTLC.sendCreateHTLC(
            sender.getSender(),
            {
                value: amount + toNano('0.05'), // amount + gas
                amount,
                receiver: receiver.address,
                hashlock,
                timelock,
            }
        );

        expect(createResult.transactions).toHaveTransaction({
            from: sender.address,
            to: fusionHTLC.address,
            success: true,
        });

        // Check HTLC was created
        const htlcData = await fusionHTLC.getHTLC(0);
        expect(htlcData).toBeTruthy();
        expect(htlcData?.sender.equals(sender.address)).toBe(true);
        expect(htlcData?.receiver.equals(receiver.address)).toBe(true);
        expect(htlcData?.amount).toEqual(amount);
        expect(htlcData?.hashlock.equals(hashlock)).toBe(true);
        expect(htlcData?.timelock).toEqual(timelock);
        expect(htlcData?.claimed).toBe(false);
        expect(htlcData?.refunded).toBe(false);
    });

    it('should claim HTLC with correct secret', async () => {
        const sender = await blockchain.treasury('sender');
        const receiver = await blockchain.treasury('receiver');
        
        // Generate secret and hashlock
        const { secret, hashlock } = await FusionHTLC.generateSecret();
        const timelock = FusionHTLC.calculateTimelock(3600);
        const amount = toNano('1');

        // Create HTLC
        await fusionHTLC.sendCreateHTLC(sender.getSender(), {
            value: amount + toNano('0.05'),
            amount,
            receiver: receiver.address,
            hashlock,
            timelock,
        });

        // Claim with correct secret
        const claimResult = await fusionHTLC.sendClaim(
            receiver.getSender(),
            {
                value: toNano('0.05'),
                htlcId: 0,
                secret,
            }
        );

        expect(claimResult.transactions).toHaveTransaction({
            from: receiver.address,
            to: fusionHTLC.address,
            success: true,
        });

        // Check funds were transferred
        expect(claimResult.transactions).toHaveTransaction({
            from: fusionHTLC.address,
            to: receiver.address,
            value: amount,
        });

        // Check HTLC is marked as claimed
        const htlcData = await fusionHTLC.getHTLC(0);
        expect(htlcData?.claimed).toBe(true);
        expect(htlcData?.secret.equals(secret)).toBe(true);
    });

    it('should reject claim with wrong secret', async () => {
        const sender = await blockchain.treasury('sender');
        const receiver = await blockchain.treasury('receiver');
        
        // Generate secret and hashlock
        const { secret, hashlock } = await FusionHTLC.generateSecret();
        const timelock = FusionHTLC.calculateTimelock(3600);
        const amount = toNano('1');

        // Create HTLC
        await fusionHTLC.sendCreateHTLC(sender.getSender(), {
            value: amount + toNano('0.05'),
            amount,
            receiver: receiver.address,
            hashlock,
            timelock,
        });

        // Try to claim with wrong secret
        const wrongSecret = Buffer.alloc(32);
        wrongSecret.fill(1);

        const claimResult = await fusionHTLC.sendClaim(
            receiver.getSender(),
            {
                value: toNano('0.05'),
                htlcId: 0,
                secret: wrongSecret,
            }
        );

        expect(claimResult.transactions).toHaveTransaction({
            from: receiver.address,
            to: fusionHTLC.address,
            success: false,
            exitCode: 101, // error::invalid_secret
        });
    });

    it('should allow refund after timelock expiry', async () => {
        const sender = await blockchain.treasury('sender');
        const receiver = await blockchain.treasury('receiver');
        
        // Generate secret and hashlock
        const { secret, hashlock } = await FusionHTLC.generateSecret();
        const timelock = Math.floor(Date.now() / 1000) + 60; // 1 minute from now
        const amount = toNano('1');

        // Create HTLC
        await fusionHTLC.sendCreateHTLC(sender.getSender(), {
            value: amount + toNano('0.05'),
            amount,
            receiver: receiver.address,
            hashlock,
            timelock,
        });

        // Fast forward time
        blockchain.now = timelock + 1;

        // Refund
        const refundResult = await fusionHTLC.sendRefund(
            sender.getSender(),
            {
                value: toNano('0.05'),
                htlcId: 0,
            }
        );

        expect(refundResult.transactions).toHaveTransaction({
            from: sender.address,
            to: fusionHTLC.address,
            success: true,
        });

        // Check funds were returned
        expect(refundResult.transactions).toHaveTransaction({
            from: fusionHTLC.address,
            to: sender.address,
            value: amount,
        });

        // Check HTLC is marked as refunded
        const htlcData = await fusionHTLC.getHTLC(0);
        expect(htlcData?.refunded).toBe(true);
    });

    it('should reject refund before timelock expiry', async () => {
        const sender = await blockchain.treasury('sender');
        const receiver = await blockchain.treasury('receiver');
        
        // Generate secret and hashlock
        const { secret, hashlock } = await FusionHTLC.generateSecret();
        const timelock = FusionHTLC.calculateTimelock(3600); // 1 hour
        const amount = toNano('1');

        // Create HTLC
        await fusionHTLC.sendCreateHTLC(sender.getSender(), {
            value: amount + toNano('0.05'),
            amount,
            receiver: receiver.address,
            hashlock,
            timelock,
        });

        // Try to refund before timelock
        const refundResult = await fusionHTLC.sendRefund(
            sender.getSender(),
            {
                value: toNano('0.05'),
                htlcId: 0,
            }
        );

        expect(refundResult.transactions).toHaveTransaction({
            from: sender.address,
            to: fusionHTLC.address,
            success: false,
            exitCode: 103, // error::not_expired
        });
    });

    it('should track multiple HTLCs', async () => {
        const sender = await blockchain.treasury('sender');
        const receiver1 = await blockchain.treasury('receiver1');
        const receiver2 = await blockchain.treasury('receiver2');

        // Create first HTLC
        const { secret: secret1, hashlock: hashlock1 } = await FusionHTLC.generateSecret();
        await fusionHTLC.sendCreateHTLC(sender.getSender(), {
            value: toNano('1.05'),
            amount: toNano('1'),
            receiver: receiver1.address,
            hashlock: hashlock1,
            timelock: FusionHTLC.calculateTimelock(3600),
        });

        // Create second HTLC
        const { secret: secret2, hashlock: hashlock2 } = FusionHTLC.generateSecret();
        await fusionHTLC.sendCreateHTLC(sender.getSender(), {
            value: toNano('2.05'),
            amount: toNano('2'),
            receiver: receiver2.address,
            hashlock: hashlock2,
            timelock: FusionHTLC.calculateTimelock(7200),
        });

        // Check next HTLC ID
        const nextId = await fusionHTLC.getNextHTLCId();
        expect(nextId).toEqual(2);

        // Check both HTLCs exist
        const htlc1 = await fusionHTLC.getHTLC(0);
        const htlc2 = await fusionHTLC.getHTLC(1);
        
        expect(htlc1?.receiver.equals(receiver1.address)).toBe(true);
        expect(htlc2?.receiver.equals(receiver2.address)).toBe(true);
        expect(htlc1?.amount).toEqual(toNano('1'));
        expect(htlc2?.amount).toEqual(toNano('2'));
    });
});