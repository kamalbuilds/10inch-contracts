import { ethers } from 'ethers';
import { CosmosResolver } from '../CosmosResolver';
import { TESTNET_CONFIG, CHAIN_IDS } from '../constants';
import { sleep } from '../utils';
import * as dotenv from 'dotenv';

dotenv.config();

interface RelayerConfig {
  cosmosRpc: string;
  evmRpc: string;
  cosmosResolverContract: string;
  evmResolverContract: string;
  relayerCosmosMnemonic: string;
  relayerEvmPrivateKey: string;
  pollingInterval: number;
}

export class CrossChainRelayer {
  private cosmosResolver: CosmosResolver;
  private evmProvider: ethers.JsonRpcProvider;
  private evmWallet: ethers.Wallet;
  private evmResolverContract: ethers.Contract;
  private config: RelayerConfig;
  private isRunning: boolean = false;

  constructor(config: RelayerConfig) {
    this.config = config;
    
    // Initialize Cosmos client
    this.cosmosResolver = new CosmosResolver({
      ...TESTNET_CONFIG,
      rpcEndpoint: config.cosmosRpc,
      resolverContract: config.cosmosResolverContract,
    });

    // Initialize EVM client
    this.evmProvider = new ethers.JsonRpcProvider(config.evmRpc);
    this.evmWallet = new ethers.Wallet(config.relayerEvmPrivateKey, this.evmProvider);

    // EVM Resolver contract ABI
    const evmResolverAbi = [
      'event OrderCreated(uint256 indexed orderId, address indexed initiator, address indexed resolver, uint32 dstChainId, string dstRecipient, bytes32 secretHash, uint256 amount, uint256 timelock)',
      'event DstEscrowDeployed(uint256 indexed orderId, address resolver, string cosmosOrderId, uint256 amount, bytes32 secretHash)',
      'event Withdrawn(uint256 indexed orderId, address indexed withdrawer, uint256 amount, bytes32 secret)',
      'function fillOrder(uint256 orderId, uint256 safetyDeposit) external payable',
      'function deployDstEscrow(uint256 orderId, string calldata cosmosOrderId, tuple(bytes32 orderHash, uint32 srcChainId, uint32 dstChainId, string srcToken, string dstToken, uint256 srcAmount, uint256 dstAmount, string resolver, string beneficiary, bytes32 secretHash, uint256 finalityTimestamp, uint256 resolverTimestamp, uint256 beneficiaryTimestamp, uint256 safetyDeposit) calldata immutables) external',
      'function getOrder(uint256 orderId) external view returns (tuple(uint256 orderId, address initiator, address resolver, uint32 srcChainId, uint32 dstChainId, address token, uint256 amount, string dstRecipient, bytes32 secretHash, uint256 timelock, uint256 safetyDeposit, bool srcDeployed, bool dstDeployed, bool completed, bool cancelled))',
    ];

    this.evmResolverContract = new ethers.Contract(
      config.evmResolverContract,
      evmResolverAbi,
      this.evmWallet
    );
  }

  async initialize(): Promise<void> {
    console.log('Initializing Cross-Chain Relayer...');
    await this.cosmosResolver.connect(this.config.relayerCosmosMnemonic);
    console.log('Cosmos client connected:', this.cosmosResolver.getSenderAddress());
    console.log('EVM client connected:', await this.evmWallet.getAddress());
  }

  async start(): Promise<void> {
    this.isRunning = true;
    console.log('Relayer started. Monitoring cross-chain events...');

    // Start monitoring both chains
    await Promise.all([
      this.monitorCosmosEvents(),
      this.monitorEvmEvents(),
    ]);
  }

  stop(): void {
    this.isRunning = false;
    console.log('Relayer stopped.');
  }

  private async monitorCosmosEvents(): Promise<void> {
    while (this.isRunning) {
      try {
        // Query recent orders from Cosmos that need relaying
        const orders = await this.cosmosResolver.queryOrdersByResolver(
          this.cosmosResolver.getSenderAddress()!,
          undefined,
          10
        );

        for (const order of orders) {
          if (order.srcDeployed && !order.dstDeployed && !order.completed && !order.cancelled) {
            console.log(`Found Cosmos order ${order.orderId} that needs destination deployment`);
            
            // Check if this is a Cosmos->EVM order
            if (order.dstChainId !== CHAIN_IDS.COSMOS) {
              await this.relayCosmosToEvm(order);
            }
          }
        }
      } catch (error) {
        console.error('Error monitoring Cosmos events:', error);
      }

      await sleep(this.config.pollingInterval);
    }
  }

  private async monitorEvmEvents(): Promise<void> {
    // Listen for EVM OrderCreated events
    this.evmResolverContract.on('OrderCreated', async (
      orderId: bigint,
      initiator: string,
      resolver: string,
      dstChainId: number,
      dstRecipient: string,
      secretHash: string,
      amount: bigint,
      timelock: bigint
    ) => {
      if (!this.isRunning) return;

      console.log(`New EVM order created: ${orderId}`);

      // Check if this order is for Cosmos
      if (dstChainId === CHAIN_IDS.COSMOS) {
        try {
          const order = await this.evmResolverContract.getOrder(orderId);
          
          // If not yet filled by a resolver, we can fill it
          if (order.resolver === ethers.ZeroAddress) {
            await this.fillEvmOrder(orderId, order);
          } else if (order.resolver === await this.evmWallet.getAddress() && !order.dstDeployed) {
            // We are the resolver and need to deploy on Cosmos
            await this.relayEvmToCosmos(orderId, order);
          }
        } catch (error) {
          console.error(`Error processing EVM order ${orderId}:`, error);
        }
      }
    });

    // Listen for secret reveals
    this.evmResolverContract.on('Withdrawn', async (
      orderId: bigint,
      withdrawer: string,
      amount: bigint,
      secret: string
    ) => {
      if (!this.isRunning) return;

      console.log(`Secret revealed on EVM for order ${orderId}: ${secret}`);

      try {
        // Find corresponding Cosmos order
        const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
        const cosmosOrderId = await this.cosmosResolver.queryOrderBySecretHash(secretHash);
        
        if (cosmosOrderId) {
          // Withdraw from Cosmos using revealed secret
          await this.withdrawFromCosmos(cosmosOrderId, secret);
        }
      } catch (error) {
        console.error(`Error processing secret reveal for order ${orderId}:`, error);
      }
    });
  }

  private async relayCosmosToEvm(cosmosOrder: any): Promise<void> {
    console.log(`Relaying Cosmos order ${cosmosOrder.orderId} to EVM...`);

    try {
      // Get escrow immutables from Cosmos
      const immutables = await this.cosmosResolver.queryEscrowImmutables(cosmosOrder.orderId);

      // Deploy destination escrow on EVM
      const tx = await this.evmResolverContract.deployDstEscrow(
        cosmosOrder.orderId,
        cosmosOrder.orderId.toString(),
        {
          orderHash: immutables.orderHash,
          srcChainId: immutables.srcChainId,
          dstChainId: immutables.dstChainId,
          srcToken: immutables.srcToken,
          dstToken: immutables.dstToken,
          srcAmount: immutables.srcAmount,
          dstAmount: immutables.dstAmount,
          resolver: immutables.resolver,
          beneficiary: immutables.beneficiary,
          secretHash: immutables.secretHash,
          finalityTimestamp: immutables.finalityTimestamp,
          resolverTimestamp: immutables.resolverTimestamp,
          beneficiaryTimestamp: immutables.beneficiaryTimestamp,
          safetyDeposit: immutables.safetyDeposit,
        }
      );

      console.log(`EVM deployment tx: ${tx.hash}`);
      await tx.wait();

      // Update Cosmos order status
      await this.cosmosResolver.deployDst(cosmosOrder.orderId);
      
      console.log(`Successfully relayed Cosmos order ${cosmosOrder.orderId} to EVM`);
    } catch (error) {
      console.error(`Failed to relay Cosmos order ${cosmosOrder.orderId}:`, error);
    }
  }

  private async fillEvmOrder(orderId: bigint, order: any): Promise<void> {
    console.log(`Filling EVM order ${orderId}...`);

    try {
      const safetyDeposit = ethers.parseEther('0.01'); // 0.01 ETH safety deposit
      
      const tx = await this.evmResolverContract.fillOrder(
        orderId,
        safetyDeposit,
        { value: safetyDeposit }
      );

      console.log(`Fill order tx: ${tx.hash}`);
      await tx.wait();

      console.log(`Successfully filled EVM order ${orderId}`);
    } catch (error) {
      console.error(`Failed to fill EVM order ${orderId}:`, error);
    }
  }

  private async relayEvmToCosmos(evmOrderId: bigint, evmOrder: any): Promise<void> {
    console.log(`Relaying EVM order ${evmOrderId} to Cosmos...`);

    try {
      // Create corresponding order on Cosmos
      const result = await this.cosmosResolver.deploySrc({
        initiator: evmOrder.initiator,
        dstChainId: evmOrder.dstChainId,
        dstRecipient: evmOrder.dstRecipient,
        dstToken: 'uatom', // Convert EVM token to Cosmos token
        srcAmount: {
          denom: 'uatom',
          amount: ethers.formatUnits(evmOrder.amount, 6), // Convert to uatom
        },
        dstAmount: evmOrder.amount.toString(),
        secretHash: evmOrder.secretHash,
        safetyDeposit: {
          denom: 'uatom',
          amount: '1000000', // 1 ATOM safety deposit
        },
        timelock: 3600, // 1 hour
      });

      console.log(`Cosmos deployment tx: ${result.transactionHash}`);

      // Extract Cosmos order ID from events
      const cosmosOrderId = result.events
        .find(e => e.type === 'wasm')
        ?.attributes.find(a => a.key === 'order_id')?.value;

      if (cosmosOrderId) {
        // Update EVM order with Cosmos order ID
        const updateTx = await this.evmResolverContract.deployDstEscrow(
          evmOrderId,
          cosmosOrderId,
          // ... immutables from Cosmos
        );

        await updateTx.wait();
        console.log(`Successfully relayed EVM order ${evmOrderId} to Cosmos`);
      }
    } catch (error) {
      console.error(`Failed to relay EVM order ${evmOrderId}:`, error);
    }
  }

  private async withdrawFromCosmos(orderId: number, secret: string): Promise<void> {
    console.log(`Withdrawing from Cosmos order ${orderId} with revealed secret...`);

    try {
      const result = await this.cosmosResolver.withdraw({
        orderId,
        secret,
        isSourceChain: true,
      });

      console.log(`Cosmos withdrawal tx: ${result.transactionHash}`);
      console.log(`Successfully withdrew from Cosmos order ${orderId}`);
    } catch (error) {
      console.error(`Failed to withdraw from Cosmos order ${orderId}:`, error);
    }
  }
}

// Run the relayer if this is the main module
if (require.main === module) {
  const relayerConfig: RelayerConfig = {
    cosmosRpc: process.env.COSMOS_RPC_ENDPOINT || 'https://rpc.testnet.cosmos.network',
    evmRpc: process.env.EVM_RPC_ENDPOINT || 'https://sepolia.infura.io/v3/your-key',
    cosmosResolverContract: process.env.COSMOS_RESOLVER_CONTRACT || '',
    evmResolverContract: process.env.EVM_RESOLVER_CONTRACT || '',
    relayerCosmosMnemonic: process.env.RELAYER_MNEMONIC || '',
    relayerEvmPrivateKey: process.env.RELAYER_PRIVATE_KEY || '',
    pollingInterval: 5000, // 5 seconds
  };

  const relayer = new CrossChainRelayer(relayerConfig);

  relayer.initialize()
    .then(() => relayer.start())
    .catch(console.error);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down relayer...');
    relayer.stop();
    process.exit(0);
  });
}