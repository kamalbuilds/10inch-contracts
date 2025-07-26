import { ethers } from 'ethers';
import axios from 'axios';
import { config } from './config';
import { HTLC, OrderStatus } from '../../resolver-service/src/types';
import logger from '../../resolver-service/src/utils/logger';

interface FusionOrder {
  orderHash: string;
  makerAsset: string;
  takerAsset: string;
  makerAmount: string;
  takerAmount: string;
  maker: string;
  receiver: string;
  salt: string;
  deadline: number;
  interaction: string;
}

interface ResolverAuction {
  orderId: string;
  startTime: number;
  endTime: number;
  startAmount: string;
  endAmount: string;
  bankFee: string;
  resolutionStartTime: number;
}

export class FusionPlusAdapter {
  private fusionAPI: string;
  private resolverAddress: string;
  private resolverPrivateKey: string;
  private whitelistContract?: ethers.Contract;

  constructor() {
    this.fusionAPI = config.fusion.apiUrl || 'https://fusion.1inch.io/v2.0';
    this.resolverAddress = config.fusion.resolverAddress;
    this.resolverPrivateKey = config.fusion.resolverPrivateKey;
  }

  async initialize() {
    // Initialize whitelist contract if configured
    if (config.fusion.whitelistContract) {
      const provider = new ethers.JsonRpcProvider(config.fusion.rpcUrl);
      const signer = new ethers.Wallet(this.resolverPrivateKey, provider);
      
      const whitelistABI = [
        'function isWhitelisted(address resolver) view returns (bool)',
        'function resolverFee() view returns (uint256)',
        'function bankFee() view returns (uint256)'
      ];
      
      this.whitelistContract = new ethers.Contract(
        config.fusion.whitelistContract,
        whitelistABI,
        signer
      );
      
      // Check if resolver is whitelisted
      const isWhitelisted = await this.whitelistContract.isWhitelisted(this.resolverAddress);
      if (!isWhitelisted) {
        logger.warn('Resolver is not whitelisted in 1inch Fusion+');
      }
    }
  }

  /**
   * Subscribe to Fusion+ orders that can be resolved through Stellar
   */
  async subscribeToOrders(callback: (order: FusionOrder) => void) {
    logger.info('Subscribing to 1inch Fusion+ orders...');
    
    // In production, this would use WebSocket connection
    // For now, we'll poll the API
    setInterval(async () => {
      try {
        const orders = await this.fetchActiveOrders();
        
        for (const order of orders) {
          if (this.canResolveOrder(order)) {
            callback(order);
          }
        }
      } catch (error) {
        logger.error('Error fetching Fusion orders:', error);
      }
    }, 10000); // Poll every 10 seconds
  }

  /**
   * Fetch active orders from Fusion+ API
   */
  private async fetchActiveOrders(): Promise<FusionOrder[]> {
    try {
      const response = await axios.get(`${this.fusionAPI}/orders/active`, {
        params: {
          limit: 100,
          networks: '1,11155111', // Ethereum mainnet and Sepolia
        }
      });
      
      return response.data.orders || [];
    } catch (error) {
      logger.error('Error fetching orders from Fusion API:', error);
      return [];
    }
  }

  /**
   * Check if we can resolve this order through Stellar
   */
  private canResolveOrder(order: FusionOrder): boolean {
    // Check if order involves cross-chain swap
    const supportedTokens = [
      '0x0000000000000000000000000000000000000000', // ETH
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
      '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // USDC on Sepolia
    ];
    
    // Check if we support the tokens
    if (!supportedTokens.includes(order.makerAsset) || 
        !supportedTokens.includes(order.takerAsset)) {
      return false;
    }
    
    // Check deadline
    if (order.deadline < Date.now() / 1000) {
      return false;
    }
    
    return true;
  }

  /**
   * Convert Fusion+ order to HTLC format
   */
  convertToHTLC(order: FusionOrder, auction: ResolverAuction): HTLC {
    // Calculate current Dutch auction price
    const currentAmount = this.calculateDutchAuctionAmount(auction);
    
    // Generate hashlock from order data
    const hashlock = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'uint256'],
        [order.orderHash, auction.resolutionStartTime]
      )
    );
    
    return {
      id: order.orderHash,
      sender: order.maker,
      receiver: this.resolverAddress, // Resolver receives first
      amount: BigInt(currentAmount),
      token: order.takerAsset,
      hashlock,
      timelock: order.deadline,
      withdrawn: false,
      refunded: false
    };
  }

  /**
   * Calculate current amount in Dutch auction
   */
  private calculateDutchAuctionAmount(auction: ResolverAuction): string {
    const now = Date.now() / 1000;
    const { startTime, endTime, startAmount, endAmount } = auction;
    
    if (now <= startTime) {
      return startAmount;
    }
    
    if (now >= endTime) {
      return endAmount;
    }
    
    // Linear interpolation
    const elapsed = now - startTime;
    const duration = endTime - startTime;
    const progress = elapsed / duration;
    
    const start = BigInt(startAmount);
    const end = BigInt(endAmount);
    const diff = start - end;
    const reduction = diff * BigInt(Math.floor(progress * 10000)) / 10000n;
    
    return (start - reduction).toString();
  }

  /**
   * Submit resolution proof to Fusion+
   */
  async submitResolution(
    orderId: string,
    proof: {
      stellarHTLCId: string;
      stellarTxHash: string;
      secret: string;
    }
  ): Promise<boolean> {
    try {
      logger.info(`Submitting resolution for order ${orderId}`);
      
      // In production, this would submit to Fusion+ settlement contract
      const provider = new ethers.JsonRpcProvider(config.fusion.rpcUrl);
      const signer = new ethers.Wallet(this.resolverPrivateKey, provider);
      
      const settlementABI = [
        'function resolveOrder(bytes32 orderHash, bytes32 secret, bytes proof) returns (bool)'
      ];
      
      const settlementContract = new ethers.Contract(
        config.fusion.settlementContract,
        settlementABI,
        signer
      );
      
      // Encode proof data
      const proofData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'string'],
        [proof.stellarHTLCId, proof.stellarTxHash, proof.secret]
      );
      
      const tx = await settlementContract.resolveOrder(
        orderId,
        proof.secret,
        proofData
      );
      
      const receipt = await tx.wait();
      logger.info(`Resolution submitted: ${receipt.hash}`);
      
      return receipt.status === 1;
    } catch (error) {
      logger.error('Error submitting resolution:', error);
      return false;
    }
  }

  /**
   * Get resolver statistics from Fusion+
   */
  async getResolverStats(): Promise<any> {
    try {
      const response = await axios.get(`${this.fusionAPI}/resolver/${this.resolverAddress}/stats`);
      return response.data;
    } catch (error) {
      logger.error('Error fetching resolver stats:', error);
      return null;
    }
  }

  /**
   * Register resolver with Fusion+ network
   */
  async registerResolver(
    supportedChains: string[],
    supportedTokens: string[],
    minVolume: string,
    maxVolume: string
  ): Promise<boolean> {
    try {
      logger.info('Registering resolver with 1inch Fusion+...');
      
      const registration = {
        resolver: this.resolverAddress,
        chains: supportedChains,
        tokens: supportedTokens,
        minVolume,
        maxVolume,
        stellarSupport: true,
        stellarContracts: {
          htlc: config.stellar.htlcContractId,
          relayer: config.stellar.relayerContractId
        }
      };
      
      // Sign registration
      const message = ethers.solidityPackedKeccak256(
        ['address', 'string[]', 'string[]', 'uint256', 'uint256'],
        [
          registration.resolver,
          registration.chains,
          registration.tokens,
          minVolume,
          maxVolume
        ]
      );
      
      const signer = new ethers.Wallet(this.resolverPrivateKey);
      const signature = await signer.signMessage(ethers.getBytes(message));
      
      // Submit registration
      const response = await axios.post(`${this.fusionAPI}/resolver/register`, {
        ...registration,
        signature
      });
      
      logger.info('Resolver registered successfully:', response.data);
      return true;
    } catch (error) {
      logger.error('Error registering resolver:', error);
      return false;
    }
  }
}