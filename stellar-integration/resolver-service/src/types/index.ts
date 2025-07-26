export interface HTLC {
  id: string;
  sender: string;
  receiver: string;
  amount: bigint;
  token: string;
  hashlock: string;
  timelock: number;
  withdrawn: boolean;
  refunded: boolean;
  secret?: string;
}

export interface CrossChainOrder {
  id: string;
  sourceChain: string;
  targetChain: string;
  sourceHTLC: HTLC;
  targetHTLC?: HTLC;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  profitMargin?: number;
  estimatedGasCost?: bigint;
}

export enum OrderStatus {
  PENDING = 'PENDING',
  SOURCE_CREATED = 'SOURCE_CREATED',
  TARGET_CREATED = 'TARGET_CREATED',
  SOURCE_WITHDRAWN = 'SOURCE_WITHDRAWN',
  TARGET_WITHDRAWN = 'TARGET_WITHDRAWN',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED'
}

export interface Token {
  address: string;
  symbol: string;
  decimals: number;
  chain: string;
  priceUSD?: number;
}

export interface PriceQuote {
  sourceToken: Token;
  targetToken: Token;
  sourceAmount: bigint;
  targetAmount: bigint;
  exchangeRate: number;
  slippage: number;
  priceImpact: number;
}

export interface ResolverMetrics {
  totalOrders: number;
  completedOrders: number;
  failedOrders: number;
  totalVolume: bigint;
  totalProfit: bigint;
  averageCompletionTime: number;
  successRate: number;
}