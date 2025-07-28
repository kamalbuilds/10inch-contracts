import {
  SigningCosmWasmClient,
  CosmWasmClient,
  ExecuteResult,
} from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';

import {
  NetworkConfig,
  Coin,
  CHAIN_IDS,
} from './types';

import {
  generateSecret,
  generateHashlock,
  verifySecret,
  isValidSecretHash,
  validateCosmosAddress,
  validateEthereumAddress,
} from './utils';

export interface ResolverOrder {
  orderId: number;
  initiator: string;
  resolver: string;
  srcChainId: number;
  dstChainId: number;
  srcAmount: Coin;
  dstAmount: string;
  dstToken: string;
  dstRecipient: string;
  safetyDeposit: Coin;
  secretHash: string;
  srcTimelock: string;
  dstTimelock: string;
  srcDeployed: boolean;
  dstDeployed: boolean;
  completed: boolean;
  cancelled: boolean;
  secret?: string;
}

export interface EscrowImmutables {
  orderHash: string;
  srcChainId: number;
  dstChainId: number;
  srcToken: string;
  dstToken: string;
  srcAmount: string;
  dstAmount: string;
  resolver: string;
  beneficiary: string;
  secretHash: string;
  finalityTimestamp: number;
  resolverTimestamp: number;
  beneficiaryTimestamp: number;
  safetyDeposit: string;
}

export interface CreateOrderParams {
  initiator: string;
  dstChainId: number;
  dstRecipient: string;
  dstToken: string;
  srcAmount: Coin;
  dstAmount: string;
  secretHash: string;
  safetyDeposit: Coin;
  timelock: number;
}

export interface WithdrawParams {
  orderId: number;
  secret: string;
  isSourceChain: boolean;
}

export class CosmosResolver {
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

  private ensureConnected(): void {
    if (!this.client || !this.senderAddress) {
      throw new Error('Client not connected. Call connect() first.');
    }
  }

  private ensureResolverContract(): void {
    if (!this.config.resolverContract) {
      throw new Error('Resolver contract address not configured');
    }
  }

  // Resolver Functions

  async deploySrc(params: CreateOrderParams): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureResolverContract();

    if (!isValidSecretHash(params.secretHash)) {
      throw new Error('Invalid secret hash format');
    }

    // Validate recipient based on target chain
    if (params.dstChainId === CHAIN_IDS.COSMOS) {
      if (!validateCosmosAddress(params.dstRecipient, this.config.prefix)) {
        throw new Error('Invalid Cosmos recipient address');
      }
    } else {
      if (!validateEthereumAddress(params.dstRecipient)) {
        throw new Error('Invalid Ethereum recipient address');
      }
    }

    const msg = {
      deploy_src: {
        initiator: params.initiator,
        dst_chain_id: params.dstChainId,
        dst_recipient: params.dstRecipient,
        dst_token: params.dstToken,
        src_amount: params.srcAmount,
        dst_amount: params.dstAmount,
        secret_hash: params.secretHash,
        safety_deposit: params.safetyDeposit,
        timelock: params.timelock,
      },
    };

    // Calculate total funds needed
    const funds = [params.srcAmount];
    if (params.srcAmount.denom !== params.safetyDeposit.denom) {
      funds.push(params.safetyDeposit);
    } else {
      // If same denom, combine amounts
      funds[0] = {
        denom: params.srcAmount.denom,
        amount: (
          BigInt(params.srcAmount.amount) + BigInt(params.safetyDeposit.amount)
        ).toString(),
      };
    }

    return await this.client!.execute(
      this.senderAddress!,
      this.config.resolverContract!,
      msg,
      'auto',
      undefined,
      funds
    );
  }

  async deployDst(orderId: number): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureResolverContract();

    const msg = {
      deploy_dst: {
        order_id: orderId,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.resolverContract!,
      msg,
      'auto'
    );
  }

  async withdraw(params: WithdrawParams): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureResolverContract();

    const msg = {
      withdraw: {
        order_id: params.orderId,
        secret: params.secret,
        is_source_chain: params.isSourceChain,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.resolverContract!,
      msg,
      'auto'
    );
  }

  async cancel(orderId: number): Promise<ExecuteResult> {
    this.ensureConnected();
    this.ensureResolverContract();

    const msg = {
      cancel: {
        order_id: orderId,
      },
    };

    return await this.client!.execute(
      this.senderAddress!,
      this.config.resolverContract!,
      msg,
      'auto'
    );
  }

  // Query Functions

  async queryOrder(orderId: number): Promise<ResolverOrder> {
    this.ensureResolverContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.resolverContract!,
      { order: { order_id: orderId } }
    );

    return this.parseOrder(response.order);
  }

  async queryOrderBySecretHash(secretHash: string): Promise<number> {
    this.ensureResolverContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const orderId = await this.queryClient.queryContractSmart(
      this.config.resolverContract!,
      { order_by_secret_hash: { secret_hash: secretHash } }
    );

    return orderId;
  }

  async queryCanWithdraw(orderId: number, user: string): Promise<{
    canWithdraw: boolean;
    reason?: string;
  }> {
    this.ensureResolverContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.resolverContract!,
      { can_withdraw: { order_id: orderId, user } }
    );

    return {
      canWithdraw: response.can_withdraw,
      reason: response.reason,
    };
  }

  async queryCanCancel(orderId: number): Promise<{
    canCancel: boolean;
    reason?: string;
  }> {
    this.ensureResolverContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.resolverContract!,
      { can_cancel: { order_id: orderId } }
    );

    return {
      canCancel: response.can_cancel,
      reason: response.reason,
    };
  }

  async queryEscrowImmutables(orderId: number): Promise<EscrowImmutables> {
    this.ensureResolverContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.resolverContract!,
      { get_escrow_immutables: { order_id: orderId } }
    );

    return response.immutables;
  }

  async queryOrdersByResolver(
    resolver: string,
    startAfter?: number,
    limit?: number
  ): Promise<ResolverOrder[]> {
    this.ensureResolverContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.resolverContract!,
      {
        orders_by_resolver: {
          resolver,
          start_after: startAfter,
          limit,
        },
      }
    );

    return response.orders.map((order: any) => this.parseOrder(order));
  }

  async queryOrdersByInitiator(
    initiator: string,
    startAfter?: number,
    limit?: number
  ): Promise<ResolverOrder[]> {
    this.ensureResolverContract();
    
    if (!this.queryClient) {
      this.queryClient = await CosmWasmClient.connect(this.config.rpcEndpoint);
    }

    const response = await this.queryClient.queryContractSmart(
      this.config.resolverContract!,
      {
        orders_by_initiator: {
          initiator,
          start_after: startAfter,
          limit,
        },
      }
    );

    return response.orders.map((order: any) => this.parseOrder(order));
  }

  // Utility Functions

  generateSecret(): string {
    return generateSecret();
  }

  generateHashlock(secret: string): string {
    return generateHashlock(secret);
  }

  async verifySecret(secret: string, secretHash: string): Promise<boolean> {
    return verifySecret(secret, secretHash);
  }

  getSenderAddress(): string | undefined {
    return this.senderAddress;
  }

  // Private helper methods

  private parseOrder(order: any): ResolverOrder {
    return {
      orderId: order.order_id,
      initiator: order.initiator,
      resolver: order.resolver,
      srcChainId: order.src_chain_id,
      dstChainId: order.dst_chain_id,
      srcAmount: order.src_amount,
      dstAmount: order.dst_amount,
      dstToken: order.dst_token,
      dstRecipient: order.dst_recipient,
      safetyDeposit: order.safety_deposit,
      secretHash: order.secret_hash,
      srcTimelock: order.src_timelock,
      dstTimelock: order.dst_timelock,
      srcDeployed: order.src_deployed,
      dstDeployed: order.dst_deployed,
      completed: order.completed,
      cancelled: order.cancelled,
      secret: order.secret,
    };
  }
}