import { connect, Contract, keyStores, utils, Account } from 'near-api-js';
import { ethers } from 'ethers';
import axios from 'axios';

// Types
interface HTLCInfo {
  id: string;
  sender: string;
  receiver: string;
  token_id: string | null;
  amount: string;
  hashlock: string;
  timelock: string;
  secret: string | null;
  withdrawn: boolean;
  refunded: boolean;
  created_at: string;
}

interface Order {
  orderId: string;
  srcChain: 'NEAR' | 'ETH' | 'BSC' | 'POLYGON';
  dstChain: 'NEAR' | 'ETH' | 'BSC' | 'POLYGON';
  srcAmount: string;
  dstAmount: string;
  srcAddress: string;
  dstAddress: string;
  hashlock: string;
  timelock: number;
  status: 'pending' | 'locked' | 'completed' | 'refunded';
}

// Configuration
const CONFIG = {
  NEAR: {
    networkId: process.env.NEAR_NETWORK || 'testnet',
    nodeUrl: process.env.NEAR_NODE_URL || 'https://rpc.testnet.near.org',
    walletUrl: process.env.NEAR_WALLET_URL || 'https://wallet.testnet.near.org',
    helperUrl: process.env.NEAR_HELPER_URL || 'https://helper.testnet.near.org',
    explorerUrl: process.env.NEAR_EXPLORER_URL || 'https://explorer.testnet.near.org',
    htlcContractId: process.env.NEAR_HTLC_CONTRACT || 'fusion-htlc.testnet',
  },
  EVM: {
    escrowFactory: process.env.EVM_ESCROW_FACTORY || '0x...',
    rpcUrls: {
      ETH: process.env.ETH_RPC_URL || 'https://sepolia.infura.io/v3/YOUR_KEY',
      BSC: process.env.BSC_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      POLYGON: process.env.POLYGON_RPC_URL || 'https://rpc-mumbai.maticvigil.com/',
    },
  },
};

export class NearFusionRelayer {
  private nearConnection: any;
  private nearAccount!: Account;
  private htlcContract!: Contract;
  private evmProviders: Map<string, ethers.Provider>;
  private evmWallets: Map<string, ethers.Wallet>;
  private orders: Map<string, Order>;
  private isRunning: boolean;

  constructor(
    private nearAccountId: string,
    private nearPrivateKey: string,
    private evmPrivateKey: string
  ) {
    this.evmProviders = new Map();
    this.evmWallets = new Map();
    this.orders = new Map();
    this.isRunning = false;
  }

  async initialize() {
    // Initialize NEAR connection
    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = utils.KeyPair.fromString(this.nearPrivateKey as any);
    await keyStore.setKey(CONFIG.NEAR.networkId, this.nearAccountId, keyPair);

    this.nearConnection = await connect({
      networkId: CONFIG.NEAR.networkId,
      keyStore,
      nodeUrl: CONFIG.NEAR.nodeUrl,
      walletUrl: CONFIG.NEAR.walletUrl,
      helperUrl: CONFIG.NEAR.helperUrl,
    });

    this.nearAccount = await this.nearConnection.account(this.nearAccountId);

    // Initialize HTLC contract
    this.htlcContract = new Contract(this.nearAccount, CONFIG.NEAR.htlcContractId, {
      viewMethods: ['get_htlc', 'get_htlc_by_hashlock', 'can_withdraw', 'can_refund'],
      changeMethods: ['create_htlc', 'withdraw', 'refund', 'create_safety_deposit'],
      useLocalViewExecution: false,
    });

    // Initialize EVM providers and wallets
    for (const [chain, rpcUrl] of Object.entries(CONFIG.EVM.rpcUrls)) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const wallet = new ethers.Wallet(this.evmPrivateKey, provider);
      this.evmProviders.set(chain, provider);
      this.evmWallets.set(chain, wallet);
    }

    console.log('✅ Relayer initialized');
    console.log(`   NEAR Account: ${this.nearAccountId}`);
    console.log(`   EVM Address: ${this.evmWallets.get('ETH')?.address}`);
  }

  async start() {
    this.isRunning = true;
    console.log('🚀 Starting NEAR Fusion relayer...');

    // Start monitoring loops
    Promise.all([
      this.monitorNearHTLCs(),
      this.monitorEVMEscrows(),
      this.processOrders(),
    ]);
  }

  async stop() {
    this.isRunning = false;
    console.log('🛑 Stopping relayer...');
  }

  // Monitor NEAR HTLCs for outbound swaps (NEAR → EVM)
  private async monitorNearHTLCs() {
    while (this.isRunning) {
      try {
        // In production, would use indexer or event streaming
        // For now, check recent transactions
        const account = await this.nearAccount.getAccountDetails();
        
        // Process any new HTLCs where we're the resolver
        // This is simplified - in production would track processed HTLCs
        
      } catch (error) {
        console.error('Error monitoring NEAR HTLCs:', error);
      }

      await this.sleep(10000); // Check every 10 seconds
    }
  }

  // Monitor EVM escrows for inbound swaps (EVM → NEAR)
  private async monitorEVMEscrows() {
    while (this.isRunning) {
      try {
        for (const [chain, provider] of this.evmProviders) {
          // Get escrow factory contract
          const escrowFactoryAbi = [
            'event EscrowCreated(address indexed escrow, address indexed initiator, bytes32 hashlock)',
            'function getEscrowDetails(address escrow) view returns (tuple(address initiator, address resolver, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded))',
          ];

          const escrowFactory = new ethers.Contract(
            CONFIG.EVM.escrowFactory,
            escrowFactoryAbi,
            provider
          );

          // Get recent escrow creation events
          const filter = escrowFactory.filters.EscrowCreated();
          const events = await escrowFactory.queryFilter(filter, -1000); // Last 1000 blocks

          for (const event of events) {
            await this.handleEVMEscrowCreated(chain, event);
          }
        }
      } catch (error) {
        console.error('Error monitoring EVM escrows:', error);
      }

      await this.sleep(15000); // Check every 15 seconds
    }
  }

  // Handle new escrow on EVM (inbound to NEAR)
  private async handleEVMEscrowCreated(chain: string, event: any) {
    const { escrow, initiator, hashlock } = event.args;
    const orderId = `${chain}_${escrow}`;

    // Check if already processed
    if (this.orders.has(orderId)) return;

    console.log(`📥 New inbound order detected on ${chain}`);
    console.log(`   Escrow: ${escrow}`);
    console.log(`   Hashlock: ${hashlock}`);

    // Get escrow details
    const wallet = this.evmWallets.get(chain)!;
    const escrowAbi = [
      'function getDetails() view returns (address initiator, address resolver, uint256 amount, bytes32 hashlock, uint256 timelock)',
      'function withdraw(bytes32 secret) external',
    ];

    const escrowContract = new ethers.Contract(escrow, escrowAbi, wallet);
    const details = await escrowContract.getDetails();

    // Create order
    const order: Order = {
      orderId,
      srcChain: chain as any,
      dstChain: 'NEAR',
      srcAmount: details.amount.toString(),
      dstAmount: this.calculateDstAmount(details.amount.toString(), chain, 'NEAR'),
      srcAddress: initiator,
      dstAddress: '', // To be determined from escrow data
      hashlock: hashlock.slice(2), // Remove 0x prefix
      timelock: Number(details.timelock),
      status: 'pending',
    };

    this.orders.set(orderId, order);

    // Create corresponding HTLC on NEAR
    await this.createNearHTLC(order);
  }

  // Create HTLC on NEAR for inbound swap
  private async createNearHTLC(order: Order) {
    try {
      console.log(`🔒 Creating NEAR HTLC for order ${order.orderId}`);

      // Convert amount to NEAR
      const nearAmount = utils.format.parseNearAmount(
        ethers.formatEther(order.dstAmount)
      );

      // Create HTLC
      const result = await (this.htlcContract as any).create_htlc({
        receiver: order.dstAddress,
        hashlock: order.hashlock,
        timelock_seconds: Math.floor(order.timelock - Date.now() / 1000),
      }, '100000000000000', nearAmount!);

      console.log(`✅ NEAR HTLC created: ${result.transaction.hash}`);
      
      order.status = 'locked';
    } catch (error) {
      console.error('Error creating NEAR HTLC:', error);
      order.status = 'refunded';
    }
  }

  // Process orders and coordinate secret sharing
  private async processOrders() {
    while (this.isRunning) {
      try {
        for (const [orderId, order] of this.orders) {
          if (order.status === 'locked') {
            await this.checkForSecretReveal(order);
          }
        }
      } catch (error) {
        console.error('Error processing orders:', error);
      }

      await this.sleep(5000); // Check every 5 seconds
    }
  }

  // Check if secret has been revealed on either chain
  private async checkForSecretReveal(order: Order) {
    // Check NEAR side
    if (order.dstChain === 'NEAR') {
      const htlc = await (this.htlcContract as any).get_htlc_by_hashlock({
        hashlock: order.hashlock,
      }) as HTLCInfo;

      if (htlc && htlc.secret) {
        // Secret revealed on NEAR, claim on EVM
        await this.claimEVMEscrow(order, htlc.secret);
      }
    }
    
    // Check EVM side
    if (order.srcChain === 'NEAR') {
      // Monitor EVM escrow for withdrawal
      // If withdrawn, get secret from logs and claim on NEAR
    }
  }

  // Claim funds from EVM escrow
  private async claimEVMEscrow(order: Order, secret: string) {
    try {
      console.log(`💰 Claiming EVM escrow for order ${order.orderId}`);

      const wallet = this.evmWallets.get(order.srcChain)!;
      const [chain, escrowAddress] = order.orderId.split('_');

      const escrowAbi = ['function withdraw(bytes32 secret) external'];
      const escrowContract = new ethers.Contract(escrowAddress, escrowAbi, wallet);

      // Claim with secret
      const secretBytes = '0x' + secret;
      const tx = await escrowContract.withdraw(secretBytes);
      await tx.wait();

      console.log(`✅ EVM escrow claimed: ${tx.hash}`);
      order.status = 'completed';
    } catch (error) {
      console.error('Error claiming EVM escrow:', error);
    }
  }

  // Calculate destination amount considering fees and exchange rates
  private calculateDstAmount(srcAmount: string, srcChain: string, dstChain: string): string {
    // Simplified - in production would use price oracles
    const fee = BigInt(srcAmount) * BigInt(3) / BigInt(1000); // 0.3% fee
    return (BigInt(srcAmount) - fee).toString();
  }

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // API endpoints for resolver service
  async getOrderStatus(orderId: string): Promise<Order | null> {
    return this.orders.get(orderId) || null;
  }

  async getSupportedRoutes() {
    return {
      inbound: [
        { from: 'ETH', to: 'NEAR', minAmount: '0.01', maxAmount: '100', estimatedTime: 300 },
        { from: 'BSC', to: 'NEAR', minAmount: '0.1', maxAmount: '1000', estimatedTime: 300 },
        { from: 'POLYGON', to: 'NEAR', minAmount: '1', maxAmount: '10000', estimatedTime: 300 },
      ],
      outbound: [
        { from: 'NEAR', to: 'ETH', minAmount: '1', maxAmount: '1000', estimatedTime: 300 },
        { from: 'NEAR', to: 'BSC', minAmount: '1', maxAmount: '1000', estimatedTime: 300 },
        { from: 'NEAR', to: 'POLYGON', minAmount: '1', maxAmount: '1000', estimatedTime: 300 },
      ],
    };
  }
}

// Export for use in scripts
export default NearFusionRelayer;