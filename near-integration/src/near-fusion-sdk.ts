import { connect, Contract, keyStores, utils, Account, Near } from 'near-api-js';
import { sha256 } from 'js-sha256';
import BN from 'bn.js';

// Contract interface
interface FusionPlusContract extends Contract {
  // Change methods
  create_htlc(args: {
    receiver: string;
    hashlock: string;
    timelock_seconds: number;
    allow_partial_fills: boolean;
    min_fill_amount?: string;
    require_safety_deposit: boolean;
  }, gas?: string, deposit?: string): Promise<string>;

  withdraw(args: {
    htlc_id: string;
    secret: string;
  }): Promise<void>;

  create_partial_fill(args: {
    htlc_id: string;
    fill_amount: string;
  }, gas?: string, deposit?: string): Promise<string>;

  withdraw_partial(args: {
    htlc_id: string;
    fill_id: string;
    secret: string;
  }): Promise<void>;

  refund(args: {
    htlc_id: string;
  }): Promise<void>;

  refund_partial_fill(args: {
    htlc_id: string;
    fill_id: string;
  }): Promise<void>;

  create_safety_deposit(args: {
    htlc_id: string;
  }, gas?: string, deposit?: string): Promise<string>;

  claim_safety_deposit(args: {
    deposit_id: string;
  }): Promise<void>;

  // View methods
  get_htlc(args: { htlc_id: string }): Promise<FusionHTLC | null>;
  get_htlc_by_hashlock(args: { hashlock: string }): Promise<FusionHTLC | null>;
  get_user_htlcs(args: { user: string; offset: number; limit: number }): Promise<FusionHTLC[]>;
  get_active_htlcs(args: { offset: number; limit: number }): Promise<FusionHTLC[]>;
  get_partial_fills(args: { htlc_id: string }): Promise<PartialFill[]>;
  get_stats(): Promise<[string, number, number]>;
  can_withdraw(args: { htlc_id: string }): Promise<boolean>;
  can_refund(args: { htlc_id: string }): Promise<boolean>;
}

// Types
export interface FusionHTLC {
  id: string;
  sender: string;
  receiver: string;
  token_id?: string;
  total_amount: string;
  remaining_amount: string;
  hashlock: string;
  timelock: string;
  secret?: string;
  allow_partial_fills: boolean;
  min_fill_amount: string;
  safety_deposit_amount: string;
  status: 'Active' | 'Completed' | 'Refunded' | 'PartiallyFilled';
  created_at: string;
}

export interface PartialFill {
  id: string;
  htlc_id: string;
  filler: string;
  amount: string;
  status: 'Pending' | 'Completed' | 'Refunded';
  created_at: string;
}

export interface CreateHTLCParams {
  receiver: string;
  secret?: string;
  hashlock?: string;
  timelockSeconds: number;
  allowPartialFills?: boolean;
  minFillAmount?: string;
  requireSafetyDeposit?: boolean;
  amount: string;
}

export interface SwapParams {
  fromChain: 'NEAR' | 'EVM';
  toChain: 'NEAR' | 'EVM';
  fromAddress: string;
  toAddress: string;
  amount: string;
  timelockSeconds?: number;
  allowPartialFills?: boolean;
  minFillAmount?: string;
}

export interface SwapResult {
  htlcId: string;
  secret: string;
  hashlock: string;
  expiryTime: number;
}

// Main SDK class
export class NearFusionSDK {
  private near!: Near;
  private account: Account | null = null;
  private contract: FusionPlusContract | null = null;
  private contractId: string;

  constructor(
    private config: {
      networkId: 'testnet' | 'mainnet';
      contractId: string;
      nodeUrl?: string;
      walletUrl?: string;
      helperUrl?: string;
    }
  ) {
    this.contractId = config.contractId;
  }

  async connect(accountId?: string, privateKey?: string): Promise<void> {
    const keyStore = new keyStores.InMemoryKeyStore();
    
    if (accountId && privateKey) {
      const keyPair = utils.KeyPair.fromString(privateKey as any);
      await keyStore.setKey(this.config.networkId, accountId, keyPair);
    }

    const nearConfig = {
      networkId: this.config.networkId,
      keyStore,
      nodeUrl: this.config.nodeUrl || `https://rpc.${this.config.networkId}.near.org`,
      walletUrl: this.config.walletUrl || `https://wallet.${this.config.networkId}.near.org`,
      helperUrl: this.config.helperUrl || `https://helper.${this.config.networkId}.near.org`,
    };

    this.near = await connect(nearConfig);
    
    if (accountId) {
      this.account = await this.near.account(accountId);
      this.contract = new Contract(this.account, this.contractId, {
        viewMethods: [
          'get_htlc',
          'get_htlc_by_hashlock',
          'get_user_htlcs',
          'get_active_htlcs',
          'get_partial_fills',
          'get_stats',
          'can_withdraw',
          'can_refund'
        ],
        changeMethods: [
          'create_htlc',
          'withdraw',
          'create_partial_fill',
          'withdraw_partial',
          'refund',
          'refund_partial_fill',
          'create_safety_deposit',
          'claim_safety_deposit'
        ],
        useLocalViewExecution: false,
      }) as FusionPlusContract;
    }
  }

  // Generate secret and hashlock
  generateSecret(): { secret: string; hashlock: string } {
    const secret = Buffer.from(Math.random().toString(36).substring(2, 15) + 
                             Math.random().toString(36).substring(2, 15))
                             .toString('hex');
    const hashlock = sha256(Buffer.from(secret, 'hex'));
    return { secret, hashlock };
  }

  // Create HTLC
  async createHTLC(params: CreateHTLCParams): Promise<SwapResult> {
    if (!this.contract) throw new Error('Not connected');

    let secret = params.secret;
    let hashlock = params.hashlock;

    if (!secret || !hashlock) {
      const generated = this.generateSecret();
      secret = generated.secret;
      hashlock = generated.hashlock;
    }

    const htlcId = await this.contract.create_htlc(
      {
        receiver: params.receiver,
        hashlock,
        timelock_seconds: params.timelockSeconds,
        allow_partial_fills: params.allowPartialFills || false,
        min_fill_amount: params.minFillAmount,
        require_safety_deposit: params.requireSafetyDeposit || false,
      },
      '100000000000000', // 100 TGas
      params.amount
    );

    const htlc = await this.getHTLC(htlcId);
    if (!htlc) throw new Error('Failed to create HTLC');

    return {
      htlcId,
      secret: secret!,
      hashlock,
      expiryTime: parseInt(htlc.timelock),
    };
  }

  // Withdraw HTLC
  async withdrawHTLC(htlcId: string, secret: string): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.withdraw({ htlc_id: htlcId, secret });
  }

  // Create partial fill
  async createPartialFill(htlcId: string, fillAmount: string): Promise<string> {
    if (!this.contract) throw new Error('Not connected');
    
    return await this.contract.create_partial_fill(
      {
        htlc_id: htlcId,
        fill_amount: fillAmount,
      },
      '100000000000000',
      fillAmount
    );
  }

  // Withdraw partial fill
  async withdrawPartialFill(htlcId: string, fillId: string, secret: string): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.withdraw_partial({
      htlc_id: htlcId,
      fill_id: fillId,
      secret,
    });
  }

  // Refund HTLC
  async refundHTLC(htlcId: string): Promise<void> {
    if (!this.contract) throw new Error('Not connected');
    await this.contract.refund({ htlc_id: htlcId });
  }

  // Get HTLC details
  async getHTLC(htlcId: string): Promise<FusionHTLC | null> {
    if (!this.contract) throw new Error('Not connected');
    return await this.contract.get_htlc({ htlc_id: htlcId });
  }

  // Get HTLC by hashlock
  async getHTLCByHashlock(hashlock: string): Promise<FusionHTLC | null> {
    if (!this.contract) throw new Error('Not connected');
    return await this.contract.get_htlc_by_hashlock({ hashlock });
  }

  // Get user HTLCs
  async getUserHTLCs(user: string, offset = 0, limit = 10): Promise<FusionHTLC[]> {
    if (!this.contract) throw new Error('Not connected');
    return await this.contract.get_user_htlcs({ user, offset, limit });
  }

  // Get active HTLCs
  async getActiveHTLCs(offset = 0, limit = 10): Promise<FusionHTLC[]> {
    if (!this.contract) throw new Error('Not connected');
    return await this.contract.get_active_htlcs({ offset, limit });
  }

  // Get partial fills
  async getPartialFills(htlcId: string): Promise<PartialFill[]> {
    if (!this.contract) throw new Error('Not connected');
    return await this.contract.get_partial_fills({ htlc_id: htlcId });
  }

  // Get contract stats
  async getStats(): Promise<{ totalVolume: string; totalHTLCs: number; activeHTLCs: number }> {
    if (!this.contract) throw new Error('Not connected');
    const [totalVolume, totalHTLCs, activeHTLCs] = await this.contract.get_stats();
    return {
      totalVolume,
      totalHTLCs,
      activeHTLCs,
    };
  }

  // Check if can withdraw
  async canWithdraw(htlcId: string): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected');
    return await this.contract.can_withdraw({ htlc_id: htlcId });
  }

  // Check if can refund
  async canRefund(htlcId: string): Promise<boolean> {
    if (!this.contract) throw new Error('Not connected');
    return await this.contract.can_refund({ htlc_id: htlcId });
  }

  // High-level swap creation
  async createSwap(params: SwapParams): Promise<SwapResult> {
    // For NEAR -> EVM swaps
    if (params.fromChain === 'NEAR' && params.toChain === 'EVM') {
      return await this.createHTLC({
        receiver: params.toAddress,
        timelockSeconds: params.timelockSeconds || 7200, // 2 hours default
        allowPartialFills: params.allowPartialFills,
        minFillAmount: params.minFillAmount,
        amount: params.amount,
      });
    }
    
    // For EVM -> NEAR swaps, this would coordinate with the EVM side
    throw new Error('EVM -> NEAR swaps should be initiated from EVM side');
  }

  // Monitor HTLCs for updates
  async monitorHTLC(
    htlcId: string,
    callback: (htlc: FusionHTLC) => void,
    intervalMs = 5000
  ): Promise<() => void> {
    const interval = setInterval(async () => {
      try {
        const htlc = await this.getHTLC(htlcId);
        if (htlc) {
          callback(htlc);
          if (htlc.status === 'Completed' || htlc.status === 'Refunded') {
            clearInterval(interval);
          }
        }
      } catch (error) {
        console.error('Error monitoring HTLC:', error);
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }

  // Utility to format NEAR amounts
  static formatNearAmount(yoctoNear: string): string {
    return utils.format.formatNearAmount(yoctoNear);
  }

  static parseNearAmount(near: string): string {
    return utils.format.parseNearAmount(near) || '0';
  }
}