import { connect, Contract, keyStores, utils, Account } from 'near-api-js';
import { ethers } from 'ethers';
import axios from 'axios';

// 1inch Fusion+ API types
interface FusionOrder {
  order: {
    maker: string;
    receiver: string;
    makerAsset: string;
    takerAsset: string;
    makingAmount: string;
    takingAmount: string;
    salt: string;
  };
  signature: string;
  auctionStartTime: number;
  auctionDuration: number;
  initialRateBump: number;
  points: Array<[number, number]>;
  whitelist: string[];
}

interface AuctionDetails {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  points: Array<{ delay: number; coefficient: number }>;
}

// NEAR types
interface ResolverConfig {
  nearAccount: string;
  nearPrivateKey: string;
  evmPrivateKey: string;
  minProfitBps: number; // Minimum profit in basis points (100 = 1%)
  maxGasPrice: string; // Maximum gas price in gwei
  supportedChains: string[];
}

export class NearFusionResolver {
  private nearConnection: any;
  private nearAccount!: Account;
  private htlcContract!: Contract;
  private evmProviders: Map<string, ethers.Provider>;
  private evmWallets: Map<string, ethers.Wallet>;
  private oneInchApiKey: string;
  private config: ResolverConfig;
  private isRunning: boolean;

  constructor(config: ResolverConfig, oneInchApiKey: string) {
    this.config = config;
    this.oneInchApiKey = oneInchApiKey;
    this.evmProviders = new Map();
    this.evmWallets = new Map();
    this.isRunning = false;
  }

  async initialize() {
    // Initialize NEAR connection
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = utils.KeyPair.fromString(this.config.nearPrivateKey as any);
    await keyStore.setKey('testnet', this.config.nearAccount, keyPair);

    this.nearConnection = await connect({
      networkId: 'testnet',
      keyStore,
      nodeUrl: 'https://rpc.testnet.near.org',
    });

    this.nearAccount = await this.nearConnection.account(this.config.nearAccount);

    // Initialize HTLC contract
    this.htlcContract = new Contract(
      this.nearAccount,
      'fusion-htlc.testnet',
      {
        viewMethods: ['get_htlc', 'can_withdraw', 'can_refund'],
        changeMethods: ['create_htlc', 'withdraw', 'refund'],
        useLocalViewExecution: false,
      }
    );

    // Initialize EVM providers
    const rpcUrls = {
      ethereum: 'https://eth-sepolia.g.alchemy.com/v2/demo',
      bsc: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      polygon: 'https://rpc-mumbai.maticvigil.com/',
    };

    for (const [chain, rpcUrl] of Object.entries(rpcUrls)) {
      if (this.config.supportedChains.includes(chain)) {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(this.config.evmPrivateKey, provider);
        this.evmProviders.set(chain, provider);
        this.evmWallets.set(chain, wallet);
      }
    }

    console.log('✅ Resolver initialized');
  }

  async start() {
    this.isRunning = true;
    console.log('🚀 Starting NEAR Fusion resolver...');

    // Start monitoring 1inch Fusion orders
    this.monitorFusionOrders();
  }

  async stop() {
    this.isRunning = false;
  }

  private async monitorFusionOrders() {
    while (this.isRunning) {
      try {
        // Get active orders from 1inch API
        const orders = await this.getActiveFusionOrders();

        for (const order of orders) {
          await this.evaluateOrder(order);
        }
      } catch (error) {
        console.error('Error monitoring orders:', error);
      }

      await this.sleep(5000); // Check every 5 seconds
    }
  }

  private async getActiveFusionOrders(): Promise<FusionOrder[]> {
    try {
      // Query 1inch Fusion API for active orders
      const response = await axios.get('https://fusion.1inch.io/v1.0/1/auction/active', {
        headers: {
          'Authorization': `Bearer ${this.oneInchApiKey}`,
        },
      });

      return response.data.items || [];
    } catch (error) {
      console.error('Error fetching Fusion orders:', error);
      return [];
    }
  }

  private async evaluateOrder(order: FusionOrder) {
    try {
      // Parse order details
      const auctionDetails = this.parseAuctionDetails(order);
      
      // Check if order involves NEAR
      if (!this.isNearRelatedOrder(auctionDetails)) {
        return;
      }

      // Calculate current auction rate
      const currentRate = this.calculateCurrentRate(order);
      
      // Estimate execution costs
      const executionCost = await this.estimateExecutionCost(auctionDetails);
      
      // Calculate potential profit
      const profit = this.calculateProfit(currentRate, executionCost, auctionDetails);
      
      // Check if profitable
      if (profit.bps >= this.config.minProfitBps) {
        console.log(`💰 Profitable order found! Profit: ${profit.bps / 100}%`);
        await this.executeOrder(order, auctionDetails);
      }
    } catch (error) {
      console.error('Error evaluating order:', error);
    }
  }

  private parseAuctionDetails(order: FusionOrder): AuctionDetails {
    // Parse 1inch order format
    return {
      fromToken: order.order.makerAsset,
      toToken: order.order.takerAsset,
      fromAmount: order.order.makingAmount,
      toAmount: order.order.takingAmount,
      points: order.points.map(([delay, coefficient]) => ({ delay, coefficient })),
    };
  }

  private isNearRelatedOrder(details: AuctionDetails): boolean {
    // Check if order involves NEAR token or wrapped NEAR on EVM
    const nearAddresses = [
      'near', // Native NEAR
      '0x85f17cf997934a597031b2e18a9ab6e9a4a77111', // Wrapped NEAR on Ethereum
      // Add more wrapped NEAR addresses
    ];

    return nearAddresses.some(addr => 
      details.fromToken.toLowerCase().includes(addr.toLowerCase()) ||
      details.toToken.toLowerCase().includes(addr.toLowerCase())
    );
  }

  private calculateCurrentRate(order: FusionOrder): number {
    const now = Date.now() / 1000;
    const elapsed = now - order.auctionStartTime;
  
    if (elapsed < 0) return 0; // Auction not started
    if (elapsed > order.auctionDuration) return 0; // Auction ended

    // Linear interpolation between points
    let prevPoint = { delay: 0, coefficient: order.initialRateBump };
    
    for (const point of order.points) {
      const [delay, coefficient] = point;
      if (elapsed <= delay) {
        const progress = (elapsed - prevPoint.delay) / (delay - prevPoint.delay);
        return prevPoint.coefficient + (coefficient - prevPoint.coefficient) * progress;
      }
      prevPoint = { delay, coefficient };
    }

    return prevPoint.coefficient;
  }

  private async estimateExecutionCost(details: AuctionDetails): Promise<bigint> {
    let totalCost = BigInt(0);

    // Estimate gas costs for each chain
    if (details.fromToken.startsWith('0x')) {
      // EVM chain
      const provider = this.evmProviders.get('ethereum')!;
      const gasPrice = await provider.getFeeData();
      const estimatedGas = BigInt(200000); // Estimate for escrow interaction
      totalCost += estimatedGas * (gasPrice.gasPrice || BigInt(0));
    } else {
      // NEAR chain
      const nearGasCost = BigInt('100000000000000'); // 0.0001 NEAR
      totalCost += nearGasCost;
    }

    return totalCost;
  }

  private calculateProfit(
    rate: number,
    executionCost: bigint,
    details: AuctionDetails
  ): { amount: bigint; bps: number } {
    const inputAmount = BigInt(details.fromAmount);
    const outputAmount = BigInt(details.toAmount);
    const rateAdjustedOutput = (outputAmount * BigInt(Math.floor(rate * 10000))) / BigInt(10000);
    
    const profit = rateAdjustedOutput - inputAmount - executionCost;
    const profitBps = Number((profit * BigInt(10000)) / inputAmount);

    return { amount: profit, bps: profitBps };
  }

  private async executeOrder(order: FusionOrder, details: AuctionDetails) {
    console.log('🔄 Executing order...');

    try {
      // Determine execution path
      if (details.fromToken.startsWith('0x') && !details.toToken.startsWith('0x')) {
        // EVM → NEAR
        await this.executeEVMToNear(order, details);
      } else if (!details.fromToken.startsWith('0x') && details.toToken.startsWith('0x')) {
        // NEAR → EVM
        await this.executeNearToEVM(order, details);
      } else {
        console.log('❌ Unsupported route');
      }
    } catch (error) {
      console.error('Error executing order:', error);
    }
  }

  private async executeEVMToNear(order: FusionOrder, details: AuctionDetails) {
    // 1. Create escrow on EVM side
    const wallet = this.evmWallets.get('ethereum')!;
    const escrowFactory = new ethers.Contract(
      '0x...', // 1inch Escrow Factory address
      ['function createEscrow(bytes32 hashlock, uint256 timelock, address receiver) payable returns (address)'],
      wallet
    );

    // Generate secret and hashlock
    const secret = ethers.randomBytes(32);
    const hashlock = ethers.keccak256(secret);

    // Create escrow
    const tx = await escrowFactory.createEscrow(
      hashlock,
      Math.floor(Date.now() / 1000) + 3600, // 1 hour timelock
      order.order.receiver,
      { value: details.fromAmount }
    );
    
    const receipt = await tx.wait();
    console.log('✅ EVM escrow created:', receipt.hash);

    // 2. Create corresponding HTLC on NEAR
    const nearAmount = utils.format.parseNearAmount(
      ethers.formatEther(details.toAmount)
    );

    const htlcResult = await (this.htlcContract as any).create_htlc({
      receiver: order.order.receiver,
      hashlock: hashlock.slice(2),
      timelock_seconds: 3600,
    }, '100000000000000', nearAmount!);

    console.log('✅ NEAR HTLC created:', htlcResult.transaction.hash);

    // 3. Monitor and complete swap
    // In production, would monitor both sides and reveal secret when appropriate
  }

  private async executeNearToEVM(order: FusionOrder, details: AuctionDetails) {
    // Similar flow but reversed
    // 1. Create HTLC on NEAR
    // 2. Create escrow on EVM
    // 3. Monitor and complete
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Utility functions for liquidity management
  async checkLiquidity(): Promise<{
    near: string;
    ethereum: string;
    bsc: string;
    polygon: string;
  }> {
    const balances: any = {};

    // Check NEAR balance
    const nearAccount = await this.nearAccount.state();
    balances.near = nearAccount.amount;

    // Check EVM balances
    for (const [chain, wallet] of this.evmWallets) {
      const balance = await wallet.provider!.getBalance(wallet.address);
      balances[chain] = balance.toString();
    }

    return balances;
  }

  async rebalanceLiquidity(fromChain: string, toChain: string, amount: string) {
    console.log(`💱 Rebalancing ${amount} from ${fromChain} to ${toChain}`);
    // Implement cross-chain rebalancing logic
  }
}

// Export for use
export default NearFusionResolver;