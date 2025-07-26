import { ethers } from 'ethers';
import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config';
import { HTLC, CrossChainOrder, OrderStatus, PriceQuote } from '../types';
import { StellarMonitor } from './StellarMonitor';
import { EVMMonitor } from './EVMMonitor';
import { OrderManager } from './OrderManager';
import { PriceOracle } from './PriceOracle';
import logger from '../utils/logger';

export class Resolver {
  private stellarMonitor: StellarMonitor;
  private evmMonitor: EVMMonitor;
  private orderManager: OrderManager;
  private priceOracle: PriceOracle;
  private isRunning: boolean = false;

  constructor() {
    this.stellarMonitor = new StellarMonitor();
    this.evmMonitor = new EVMMonitor();
    this.orderManager = new OrderManager();
    this.priceOracle = new PriceOracle();

    this.setupEventHandlers();
  }

  async start() {
    if (this.isRunning) {
      logger.warn('Resolver already running');
      return;
    }

    logger.info('Starting resolver service...');
    this.isRunning = true;

    // Start all monitors
    await Promise.all([
      this.stellarMonitor.start(),
      this.evmMonitor.start(),
      this.orderManager.start()
    ]);

    logger.info('Resolver service started successfully');
  }

  async stop() {
    logger.info('Stopping resolver service...');
    this.isRunning = false;

    this.stellarMonitor.stop();
    this.evmMonitor.stop();
    await this.orderManager.stop();

    logger.info('Resolver service stopped');
  }

  private setupEventHandlers() {
    // Handle HTLC creation events
    this.stellarMonitor.on('htlc:created', (data) => this.handleHTLCCreated('stellar', data));
    this.evmMonitor.on('htlc:created', (data) => this.handleHTLCCreated('evm', data));

    // Handle HTLC withdrawal events
    this.stellarMonitor.on('htlc:withdrawn', (data) => this.handleHTLCWithdrawn('stellar', data));
    this.evmMonitor.on('htlc:withdrawn', (data) => this.handleHTLCWithdrawn('evm', data));
  }

  private async handleHTLCCreated(source: string, data: any) {
    logger.info(`HTLC created on ${source}:`, data);

    try {
      // Check if this is a profitable opportunity
      const isProfitable = await this.evaluateOpportunity(data.chain, data.htlc);
      
      if (!isProfitable) {
        logger.info('Opportunity not profitable, skipping');
        return;
      }

      // Create a cross-chain order
      const order: CrossChainOrder = {
        id: `${data.chain}-${data.htlc.id}`,
        sourceChain: data.chain,
        targetChain: this.getTargetChain(data.chain),
        sourceHTLC: data.htlc,
        status: OrderStatus.SOURCE_CREATED,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Save order
      await this.orderManager.createOrder(order);

      // Create corresponding HTLC on target chain
      await this.createTargetHTLC(order);
    } catch (error) {
      logger.error('Error handling HTLC creation:', error);
    }
  }

  private async handleHTLCWithdrawn(source: string, data: any) {
    logger.info(`HTLC withdrawn on ${source}:`, data);

    try {
      // Find the corresponding order
      const order = await this.orderManager.findOrderByHTLC(data.chain, data.htlcId);
      
      if (!order) {
        logger.warn('No order found for withdrawn HTLC');
        return;
      }

      // Use the revealed secret to withdraw from our HTLC
      if (data.chain === order.targetChain && order.sourceHTLC) {
        await this.withdrawFromSourceHTLC(order, data.secret);
      }
    } catch (error) {
      logger.error('Error handling HTLC withdrawal:', error);
    }
  }

  private async evaluateOpportunity(chain: string, htlc: HTLC): Promise<boolean> {
    try {
      // Get price quotes
      const targetChain = this.getTargetChain(chain);
      const quote = await this.priceOracle.getQuote({
        sourceChain: chain,
        targetChain,
        sourceToken: htlc.token,
        sourceAmount: htlc.amount
      });

      if (!quote) {
        logger.warn('Could not get price quote');
        return false;
      }

      // Calculate profit margin
      const gasCost = await this.estimateGasCost(chain, targetChain);
      const totalCost = gasCost + (quote.targetAmount * BigInt(Math.floor(quote.slippage * 10000)) / 10000n);
      const profit = htlc.amount - totalCost;
      const profitMargin = Number(profit * 10000n / htlc.amount) / 10000;

      logger.info(`Profit margin: ${profitMargin * 100}%`);

      return profitMargin >= config.resolver.minProfitMargin;
    } catch (error) {
      logger.error('Error evaluating opportunity:', error);
      return false;
    }
  }

  private async createTargetHTLC(order: CrossChainOrder) {
    logger.info(`Creating target HTLC for order ${order.id}`);

    try {
      if (order.targetChain === 'stellar') {
        await this.createStellarHTLC(order);
      } else {
        await this.createEVMHTLC(order);
      }

      // Update order status
      order.status = OrderStatus.TARGET_CREATED;
      order.updatedAt = new Date();
      await this.orderManager.updateOrder(order);
    } catch (error) {
      logger.error('Error creating target HTLC:', error);
      order.status = OrderStatus.FAILED;
      await this.orderManager.updateOrder(order);
    }
  }

  private async createStellarHTLC(order: CrossChainOrder) {
    // Implementation for creating Stellar HTLC
    logger.info('Creating Stellar HTLC...');
    
    // This would use the Stellar SDK to create the HTLC
    // For now, we'll use the CLI command as shown in the test
    const { execSync } = require('child_process');
    
    const command = `stellar contract invoke \
      --id ${config.stellar.htlcContractId} \
      --source deployer \
      --network testnet \
      -- create_htlc \
      --sender ${config.stellar.resolverSecretKey} \
      --receiver ${order.sourceHTLC.sender} \
      --token ${config.stellar.nativeTokenContract} \
      --amount ${order.sourceHTLC.amount} \
      --hashlock ${order.sourceHTLC.hashlock.slice(2)} \
      --timelock ${order.sourceHTLC.timelock - 3600}`;
    
    const result = execSync(command, { encoding: 'utf-8' });
    const htlcId = result.trim();
    
    order.targetHTLC = {
      ...order.sourceHTLC,
      id: htlcId,
      sender: config.stellar.resolverSecretKey,
      receiver: order.sourceHTLC.sender
    };
  }

  private async createEVMHTLC(order: CrossChainOrder) {
    // Implementation for creating EVM HTLC
    logger.info(`Creating EVM HTLC on ${order.targetChain}...`);
    
    const networkConfig = config.evm.networks[order.targetChain];
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const wallet = new ethers.Wallet(networkConfig.resolverPrivateKey, provider);
    
    const htlcContract = new ethers.Contract(
      networkConfig.htlcAddress,
      ['function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32)'],
      wallet
    );
    
    const tx = await htlcContract.createHTLC(
      order.sourceHTLC.sender, // Receiver is the original sender
      order.sourceHTLC.hashlock,
      order.sourceHTLC.timelock - 3600, // 1 hour less timelock
      { value: order.sourceHTLC.amount }
    );
    
    const receipt = await tx.wait();
    // Extract HTLC ID from events
    const htlcId = receipt.logs[0].topics[1]; // Assuming first event is HTLCCreated
    
    order.targetHTLC = {
      ...order.sourceHTLC,
      id: htlcId,
      sender: wallet.address,
      receiver: order.sourceHTLC.sender
    };
  }

  private async withdrawFromSourceHTLC(order: CrossChainOrder, secret: string) {
    logger.info(`Withdrawing from source HTLC with secret: ${secret}`);

    try {
      if (order.sourceChain === 'stellar') {
        await this.withdrawFromStellarHTLC(order.sourceHTLC.id, secret);
      } else {
        await this.withdrawFromEVMHTLC(order.sourceChain, order.sourceHTLC.id, secret);
      }

      // Update order status
      order.status = OrderStatus.COMPLETED;
      order.updatedAt = new Date();
      await this.orderManager.updateOrder(order);

      logger.info(`Order ${order.id} completed successfully!`);
    } catch (error) {
      logger.error('Error withdrawing from source HTLC:', error);
      order.status = OrderStatus.FAILED;
      await this.orderManager.updateOrder(order);
    }
  }

  private async withdrawFromStellarHTLC(htlcId: string, secret: string) {
    const { execSync } = require('child_process');
    
    const command = `stellar contract invoke \
      --id ${config.stellar.htlcContractId} \
      --source deployer \
      --network testnet \
      -- withdraw \
      --htlc_id ${htlcId} \
      --secret ${secret}`;
    
    execSync(command, { encoding: 'utf-8' });
  }

  private async withdrawFromEVMHTLC(network: string, htlcId: string, secret: string) {
    const networkConfig = config.evm.networks[network];
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const wallet = new ethers.Wallet(networkConfig.resolverPrivateKey, provider);
    
    const htlcContract = new ethers.Contract(
      networkConfig.htlcAddress,
      ['function withdraw(bytes32 _contractId, bytes32 _preimage)'],
      wallet
    );
    
    const tx = await htlcContract.withdraw(htlcId, secret);
    await tx.wait();
  }

  private getTargetChain(sourceChain: string): string {
    // Simple mapping for now
    if (sourceChain === 'stellar') return 'sepolia';
    if (sourceChain === 'sepolia') return 'stellar';
    return 'stellar';
  }

  private async estimateGasCost(sourceChain: string, targetChain: string): Promise<bigint> {
    // Simplified gas estimation
    // In production, this would calculate actual gas costs
    if (targetChain === 'stellar') {
      return BigInt('10000000'); // 1 XLM
    } else {
      return ethers.parseEther('0.001'); // 0.001 ETH
    }
  }
}