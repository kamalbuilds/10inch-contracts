import { connect, keyStores, utils, Contract, Account } from 'near-api-js';
import { ethers } from 'ethers';
import crypto from 'crypto';

// Types
export interface SwapParams {
  direction: 'NEAR_TO_EVM' | 'EVM_TO_NEAR';
  srcChain: string;
  dstChain: string;
  srcToken: string; // Token address or 'NEAR'
  dstToken: string; // Token address or 'NEAR'
  amount: string;
  sender: string;
  receiver: string;
  slippage?: number; // In basis points
}

export interface SwapResult {
  swapId: string;
  srcTxHash: string;
  dstTxHash?: string;
  secret?: string;
  secretHash: string;
  status: 'pending' | 'locked' | 'completed' | 'refunded';
  expiryTime: number;
}

export class NearFusionClient {
  private nearConnection: any;
  private nearAccount: Account | null = null;
  private htlcContract: Contract | null = null;
  private evmProviders: Map<string, ethers.Provider>;
  private initialized: boolean = false;

  constructor() {
    this.evmProviders = new Map();
  }

  async initialize(config: {
    nearNetwork: 'mainnet' | 'testnet';
    nearAccountId?: string;
    nearPrivateKey?: string;
    evmRpcUrls: Record<string, string>;
  }) {
    // Initialize NEAR connection
    const keyStore = new keyStores.InMemoryKeyStore();
    
    if (config.nearAccountId && config.nearPrivateKey) {
      const keyPair = utils.KeyPair.fromString(config.nearPrivateKey as any);
      await keyStore.setKey(config.nearNetwork, config.nearAccountId, keyPair);
    }

    this.nearConnection = await connect({
      networkId: config.nearNetwork,
      keyStore,
      nodeUrl: config.nearNetwork === 'mainnet' 
        ? 'https://rpc.mainnet.near.org'
        : 'https://rpc.testnet.near.org',
    });

    if (config.nearAccountId) {
      this.nearAccount = await this.nearConnection.account(config.nearAccountId);
      
      // Initialize HTLC contract
      const htlcContractId = config.nearNetwork === 'mainnet'
        ? 'fusion-htlc.near'
        : 'fusion-htlc.testnet';
        
      this.htlcContract = new Contract(this.nearAccount!, htlcContractId, {
        viewMethods: ['get_htlc', 'get_htlc_by_hashlock', 'can_withdraw', 'can_refund'],
        changeMethods: ['create_htlc', 'withdraw', 'refund'],
        useLocalViewExecution: false,
      });
    }

    // Initialize EVM providers
    for (const [chain, rpcUrl] of Object.entries(config.evmRpcUrls)) {
      this.evmProviders.set(chain, new ethers.JsonRpcProvider(rpcUrl));
    }

    this.initialized = true;
  }

  async createSwap(params: SwapParams): Promise<SwapResult> {
    if (!this.initialized) {
      throw new Error('Client not initialized');
    }

    // Generate secret and hash
    const secret = crypto.randomBytes(32);
    const secretHex = secret.toString('hex');
    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');

    const swapId = `swap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiryTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour

    let result: SwapResult = {
      swapId,
      srcTxHash: '',
      secretHash,
      secret: secretHex,
      status: 'pending',
      expiryTime,
    };

    if (params.direction === 'NEAR_TO_EVM') {
      result = await this.createNearToEVMSwap(params, secretHash, expiryTime, result);
    } else {
      result = await this.createEVMToNearSwap(params, secretHash, expiryTime, result);
    }

    return result;
  }

  private async createNearToEVMSwap(
    params: SwapParams,
    secretHash: string,
    expiryTime: number,
    result: SwapResult
  ): Promise<SwapResult> {
    if (!this.nearAccount || !this.htlcContract) {
      throw new Error('NEAR account not configured');
    }

    // Create HTLC on NEAR
    const htlcResult = await (this.htlcContract as any).create_htlc({
      receiver: params.receiver,
      hashlock: secretHash,
      timelock_seconds: expiryTime - Math.floor(Date.now() / 1000),
    }, '100000000000000', params.srcToken === 'NEAR' 
      ? utils.format.parseNearAmount(params.amount)!
      : '0');

    result.srcTxHash = htlcResult.transaction.hash;
    result.status = 'locked';

    // Notify resolver service about the swap
    await this.notifyResolver({
      swapId: result.swapId,
      direction: 'NEAR_TO_EVM',
      srcChain: 'NEAR',
      dstChain: params.dstChain,
      amount: params.amount,
      secretHash,
      expiryTime,
    });

    return result;
  }

  private async createEVMToNearSwap(
    params: SwapParams,
    secretHash: string,
    expiryTime: number,
    result: SwapResult
  ): Promise<SwapResult> {
    const provider = this.evmProviders.get(params.srcChain);
    if (!provider) {
      throw new Error(`Provider not found for chain: ${params.srcChain}`);
    }

    // Get escrow factory contract
    const escrowFactoryAddress = this.getEscrowFactoryAddress(params.srcChain);
    const escrowFactoryAbi = [
      'function createEscrow(bytes32 hashlock, uint256 timelock, address receiver, address token, uint256 amount) payable returns (address)',
    ];

    // For ethers v6, we need to use a Wallet or other signer
    // This is a mock implementation for demo purposes
    throw new Error('EVM transaction signing not implemented in demo mode');
    await this.notifyResolver({
      swapId: result.swapId,
      direction: 'EVM_TO_NEAR',
      srcChain: params.srcChain,
      dstChain: 'NEAR',
      amount: params.amount,
      secretHash,
      expiryTime,
    });

    return result;
  }

  async claimSwap(swapId: string, secret: string): Promise<string> {
    // Implement claim logic based on swap direction
    // This would interact with the appropriate chain to claim funds
    throw new Error('Not implemented');
  }

  async refundSwap(swapId: string): Promise<string> {
    // Implement refund logic for expired swaps
    throw new Error('Not implemented');
  }

  async getSwapStatus(swapId: string): Promise<SwapResult | null> {
    // Query swap status from resolver service
    try {
      const response = await fetch(`${this.getResolverUrl()}/api/swap/${swapId}`);
      if (response.ok) {
        return await response.json() as SwapResult;
      }
    } catch (error) {
      console.error('Error fetching swap status:', error);
    }
    return null;
  }

  private async notifyResolver(swapInfo: any) {
    try {
      await fetch(`${this.getResolverUrl()}/api/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(swapInfo),
      });
    } catch (error) {
      console.error('Error notifying resolver:', error);
    }
  }

  private getEscrowFactoryAddress(chain: string): string {
    const addresses: Record<string, string> = {
      ethereum: '0x...', // 1inch Escrow Factory on Ethereum
      bsc: '0x...',      // 1inch Escrow Factory on BSC
      polygon: '0x...',  // 1inch Escrow Factory on Polygon
    };
    return addresses[chain] || '';
  }

  private getResolverUrl(): string {
    return process.env.RESOLVER_URL || 'http://localhost:3000';
  }

  // Utility functions
  async estimateFee(params: SwapParams): Promise<{
    protocolFee: string;
    networkFee: string;
    totalFee: string;
  }> {
    const protocolFee = BigInt(params.amount) * BigInt(30) / BigInt(10000); // 0.3%
    let networkFee = BigInt(0);

    if (params.direction === 'NEAR_TO_EVM') {
      // NEAR gas fee estimation
      networkFee = BigInt('100000000000000'); // 0.0001 NEAR
    } else {
      // EVM gas fee estimation
      const provider = this.evmProviders.get(params.srcChain);
      if (provider) {
        const feeData = await provider.getFeeData();
        const gasLimit = BigInt(200000); // Estimate for escrow creation
        networkFee = gasLimit * (feeData.gasPrice || BigInt(0));
      }
    }

    return {
      protocolFee: protocolFee.toString(),
      networkFee: networkFee.toString(),
      totalFee: (protocolFee + networkFee).toString(),
    };
  }

  async getSupportedTokens(chain: string): Promise<Array<{
    address: string;
    symbol: string;
    decimals: number;
  }>> {
    if (chain === 'NEAR') {
      return [
        { address: 'NEAR', symbol: 'NEAR', decimals: 24 },
        { address: 'wrap.near', symbol: 'wNEAR', decimals: 24 },
        { address: 'usdc.near', symbol: 'USDC', decimals: 6 },
        { address: 'usdt.near', symbol: 'USDT', decimals: 6 },
      ];
    } else {
      // Return common tokens for EVM chains
      return [
        { address: ethers.ZeroAddress, symbol: 'ETH', decimals: 18 },
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
        { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
      ];
    }
  }
}

export default NearFusionClient;