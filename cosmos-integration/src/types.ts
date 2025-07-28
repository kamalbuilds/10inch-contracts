export interface Config {
  owner: string;
  protocolFeeBps: number;
  minTimelockDuration: number;
  maxTimelockDuration: number;
}

export interface BridgeConfig extends Config {
  ibcTimeoutSeconds: number;
}

export interface ChainConfig {
  chainId: number;
  chainName: string;
  ibcChannel: string;
  isActive: boolean;
  feeMultiplier: number;
}

export enum SwapStatus {
  Active = 'active',
  Completed = 'completed',
  Refunded = 'refunded',
}

export enum OrderStatus {
  Pending = 'pending',
  Active = 'active',
  Completed = 'completed',
  Refunded = 'refunded',
  Failed = 'failed',
}

export interface Swap {
  id: string;
  initiator: string;
  recipient: string;
  amount: Coin;
  secretHash: string;
  timelock: string;
  status: SwapStatus;
  createdAt: string;
  completedAt?: string;
  secret?: string;
}

export interface BridgeOrder {
  orderId: string;
  initiator: string;
  sourceChainId: number;
  targetChainId: number;
  recipient: string;
  amount: Coin;
  secretHash: string;
  timelock: string;
  status: OrderStatus;
  createdAt: string;
  completedAt?: string;
  secret?: string;
  ibcPacketSequence?: number;
}

export interface Coin {
  denom: string;
  amount: string;
}

export interface CreateSwapParams {
  recipient: string;
  secretHash: string;
  timelock: number;
  amount: Coin;
}

export interface CreateBridgeOrderParams {
  targetChainId: number;
  recipient: string;
  secretHash: string;
  timelock: number;
  amount: Coin;
}

export interface CompleteSwapParams {
  swapId: string;
  secret: string;
}

export interface CompleteBridgeOrderParams {
  orderId: string;
  secret: string;
}

export interface QuerySwapsParams {
  initiator?: string;
  recipient?: string;
  status?: SwapStatus;
  startAfter?: string;
  limit?: number;
}

export interface QueryOrdersParams {
  initiator?: string;
  status?: OrderStatus;
  chainId?: number;
  startAfter?: string;
  limit?: number;
}

export interface NetworkConfig {
  rpcEndpoint: string;
  chainId: string;
  prefix: string;
  gasPrice: string;
  atomicSwapContract?: string;
  bridgeContract?: string;
  resolverContract?: string;
}

export const CHAIN_IDS = {
  COSMOS: 1,
  ETHEREUM_SEPOLIA: 11155111,
  BSC: 56,
  POLYGON_MUMBAI: 80001,
  ARBITRUM_SEPOLIA: 421614,
  OPTIMISM_SEPOLIA: 11155420,
} as const;

export type ChainId = typeof CHAIN_IDS[keyof typeof CHAIN_IDS];