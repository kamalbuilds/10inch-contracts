import {
  SigningCosmWasmClient,
  CosmWasmClient,
  ExecuteResult,
} from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import { Coin } from '@cosmjs/amino';

import {
  Config,
  BridgeConfig,
  ChainConfig,
  Swap,
  BridgeOrder,
  SwapStatus,
  OrderStatus,
  CreateSwapParams,
  CreateBridgeOrderParams,
  CompleteSwapParams,
  CompleteBridgeOrderParams,
  QuerySwapsParams,
  QueryOrdersParams,
  NetworkConfig,
  CHAIN_IDS,
} from './types';

import {
  generateSecret,
  generateHashlock,
  verifySecret,
  validateTimelock,
  isValidSecretHash,
  validateCosmosAddress,
  validateEthereumAddress,
} from './utils';

import { DEFAULT_GAS_LIMITS } from './constants';

export class CosmosAtomicSwap {
  private client?: SigningCosmWasmClient;
  private queryClient?: CosmWasmClient;
  private wallet?: DirectSecp256k1HdWallet;
  private config: NetworkConfig;
  private senderAddress?: string;

  constructor(config: NetworkConfig) {
    this.config = config;
  }

  async connect(mnemonic: string): Promise<void> {
    this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: this.config.prefix,
    });

    const [account] = await this.wallet.getAccounts();
    this.senderAddress = account.address;

    this.client = await SigningCosmWasmClient.connectWithSigner(
      this.config.rpcEndpoint,
      this.wallet,
      {
        gasPrice: GasPrice.fromString(this.config.gasPrice),
      }
    );

    this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
  }

  async connectWithSigner(signer: DirectSecp256k1HdWallet): Promise<void> {
    this.wallet = signer;

    const [account] = await this.wallet.getAccounts();
    this.senderAddress = account.address;

    this.client = await SigningCosmWasmClient.connectWithSigner(
      this.config.rpcEndpoint,
      this.wallet,
      {
        gasPrice: GasPrice.fromString(this.config.gasPrice),
      }
    );

    this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
  }

  private ensureConnected(): void {
    if (!this.client || !this.senderAddress) {
      throw new Error('Client not connected. Call connect() first.');
    }
  }

  private ensureAtomicSwapContract(): void {
    if (!this.config.atomicSwapContract) {
      throw new Error('Atomic swap contract address not configured');
    }
  }

  private ensureBridgeContract(): void {
    if (!this.config.bridgeContract) {
      throw new Error('Bridge contract address not configured');
    }
  }

  // Atomic Swap Methods

  async createSwap(params: CreateSwapParams): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureAtomicSwapContract();

    if (!isValidSecretHash(params.secretHash)) {
      throw new Error('Invalid secret hash format');
    }

    validateTimelock(params.timelock);

    if (!validateCosmosAddress(params.recipient, this.config.prefix)) {
      throw new Error('Invalid recipient address');
    }

    const msg = {
      create_swap: {
        recipient: params.recipient,
        secret_hash: params.secretHash,
        timelock: params.timelock,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.atomicSwapContract!,
      msg,
      'auto',
      undefined,
      [params.amount]
    );
  }

  async completeSwap(params: CompleteSwapParams): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureAtomicSwapContract();

    const msg = {
      complete_swap: {
        swap_id: params.swapId,
        secret: params.secret,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.atomicSwapContract!,
      msg,
      'auto'
    );
  }

  async refundSwap(swapId: string): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureAtomicSwapContract();

    const msg = {
      refund_swap: {
        swap_id: swapId,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.atomicSwapContract!,
      msg,
      'auto'
    );
  }

  async querySwap(swapId: string): Promise<Swap> {
    this.ensureAtomicSwapContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.atomicSwapContract!,
      { swap: { swap_id: swapId } }
    );

    return this.parseSwap(response.swap);
  }

  async querySwaps(params: QuerySwapsParams): Promise<Swap[]> {
    this.ensureAtomicSwapContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    let query: any = {};

    if (params.initiator) {
      query = {
        swaps_by_initiator: {
          initiator: params.initiator,
          start_after: params.startAfter,
          limit: params.limit,
        },
      };
    } else if (params.recipient) {
      query = {
        swaps_by_recipient: {
          recipient: params.recipient,
          start_after: params.startAfter,
          limit: params.limit,
        },
      };
    } else if (params.status) {
      query = {
        swaps_by_status: {
          status: params.status,
          start_after: params.startAfter,
          limit: params.limit,
        },
      };
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.atomicSwapContract!,
      query
    );

    return response.swaps.map((swap: any) => this.parseSwap(swap));
  }

  async queryAtomicSwapConfig(): Promise<Config> {
    this.ensureAtomicSwapContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.atomicSwapContract!,
      { config: {} }
    );

    return {
      owner: response.owner,
      protocolFeeBps: response.protocol_fee_bps,
      minTimelockDuration: response.min_timelock_duration,
      maxTimelockDuration: response.max_timelock_duration,
    };
  }

  // Bridge Methods

  async createBridgeOrder(params: CreateBridgeOrderParams): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureBridgeContract();

    if (!isValidSecretHash(params.secretHash)) {
      throw new Error('Invalid secret hash format');
    }

    validateTimelock(params.timelock);

    // Validate recipient based on target chain
    if (params.targetChainId === CHAIN_IDS.COSMOS) {
      if (!validateCosmosAddress(params.recipient, this.config.prefix)) {
        throw new Error('Invalid Cosmos recipient address');
      }
    } else {
      if (!validateEthereumAddress(params.recipient)) {
        throw new Error('Invalid Ethereum recipient address');
      }
    }

    const msg = {
      create_bridge_order: {
        target_chain_id: params.targetChainId,
        recipient: params.recipient,
        secret_hash: params.secretHash,
        timelock: params.timelock,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.bridgeContract!,
      msg,
      'auto',
      undefined,
      [params.amount]
    );
  }

  async completeBridgeOrder(params: CompleteBridgeOrderParams): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureBridgeContract();

    const msg = {
      complete_bridge_order: {
        order_id: params.orderId,
        secret: params.secret,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.bridgeContract!,
      msg,
      'auto'
    );
  }

  async refundBridgeOrder(orderId: string): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureBridgeContract();

    const msg = {
      refund_bridge_order: {
        order_id: orderId,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.bridgeContract!,
      msg,
      'auto'
    );
  }

  async queryBridgeOrder(orderId: string): Promise<BridgeOrder> {
    this.ensureBridgeContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.bridgeContract!,
      { bridge_order: { order_id: orderId } }
    );

    return this.parseBridgeOrder(response.order);
  }

  async queryBridgeOrders(params: QueryOrdersParams): Promise<BridgeOrder[]> {
    this.ensureBridgeContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    let query: any = {};

    if (params.initiator) {
      query = {
        orders_by_initiator: {
          initiator: params.initiator,
          start_after: params.startAfter,
          limit: params.limit,
        },
      };
    } else if (params.status) {
      query = {
        orders_by_status: {
          status: params.status,
          start_after: params.startAfter,
          limit: params.limit,
        },
      };
    } else if (params.chainId) {
      query = {
        orders_by_chain: {
          chain_id: params.chainId,
          start_after: params.startAfter,
          limit: params.limit,
        },
      };
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.bridgeContract!,
      query
    );

    return response.orders.map((order: any) => this.parseBridgeOrder(order));
  }

  async queryChainConfig(chainId: number): Promise<ChainConfig> {
    this.ensureBridgeContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.bridgeContract!,
      { chain_config: { chain_id: chainId } }
    );

    return {
      chainId: response.config.chain_id,
      chainName: response.config.chain_name,
      ibcChannel: response.config.ibc_channel,
      isActive: response.config.is_active,
      feeMultiplier: response.config.fee_multiplier,
    };
  }

  async queryBridgeConfig(): Promise<BridgeConfig> {
    this.ensureBridgeContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.bridgeContract!,
      { config: {} }
    );

    return {
      owner: response.owner,
      protocolFeeBps: response.protocol_fee_bps,
      minTimelockDuration: response.min_timelock_duration,
      maxTimelockDuration: response.max_timelock_duration,
      ibcTimeoutSeconds: response.ibc_timeout_seconds,
    };
  }

  // Utility Methods

  async verifySecret(secret: string, secretHash: string): Promise<boolean> {
    return verifySecret(secret, secretHash);
  }

  generateSecret(): string {
    return generateSecret();
  }

  generateHashlock(secret: string): string {
    return generateHashlock(secret);
  }

  getSenderAddress(): string | undefined {
    return this.senderAddress;
  }

  // Private helper methods

  private parseSwap(swap: any): Swap {
    return {
      id: swap.id,
      initiator: swap.initiator,
      recipient: swap.recipient,
      amount: swap.amount,
      secretHash: swap.secret_hash,
      timelock: swap.timelock,
      status: this.parseSwapStatus(swap.status),
      createdAt: swap.created_at,
      completedAt: swap.completed_at,
      secret: swap.secret,
    };
  }

  private parseBridgeOrder(order: any): BridgeOrder {
    return {
      orderId: order.order_id,
      initiator: order.initiator,
      sourceChainId: order.source_chain_id,
      targetChainId: order.target_chain_id,
      recipient: order.recipient,
      amount: order.amount,
      secretHash: order.secret_hash,
      timelock: order.timelock,
      status: this.parseOrderStatus(order.status),
      createdAt: order.created_at,
      completedAt: order.completed_at,
      secret: order.secret,
      ibcPacketSequence: order.ibc_packet_sequence,
    };
  }

  private parseSwapStatus(status: string | { [key: string]: any }): SwapStatus {
    if (typeof status === 'string') {
      return status as SwapStatus;
    }
    
    const key = Object.keys(status)[0];
    return key as SwapStatus;
  }

  private parseOrderStatus(status: string | { [key: string]: any }): OrderStatus {
    if (typeof status === 'string') {
      return status as OrderStatus;
    }
    
    const key = Object.keys(status)[0];
    return key as OrderStatus;
  }
}