import express from 'express';
import cors from 'cors';
import { config } from '../config';
import logger from '../utils/logger';
import { Resolver } from '../services/Resolver';
import { OrderManager } from '../services/OrderManager';

export class APIServer {
  private app: express.Application;
  private resolver: Resolver;
  private orderManager: OrderManager;

  constructor(resolver: Resolver, orderManager: OrderManager) {
    this.app = express();
    this.resolver = resolver;
    this.orderManager = orderManager;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(cors({
      origin: config.api.corsOrigins
    }));
    this.app.use(express.json());
    
    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });

    // Get resolver metrics
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.orderManager.getMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error('Error getting metrics:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get active orders
    this.app.get('/orders', async (req, res) => {
      try {
        const orders = await this.orderManager.getActiveOrders();
        res.json(orders);
      } catch (error) {
        logger.error('Error getting orders:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get specific order
    this.app.get('/orders/:id', async (req, res) => {
      try {
        const order = await this.orderManager.getOrder(req.params.id);
        if (!order) {
          return res.status(404).json({ error: 'Order not found' });
        }
        res.json(order);
      } catch (error) {
        logger.error('Error getting order:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Supported chains
    this.app.get('/chains', (req, res) => {
      res.json({
        stellar: {
          htlcContract: config.stellar.htlcContractId,
          relayerContract: config.stellar.relayerContractId,
          supported: true
        },
        evm: Object.keys(config.evm.networks).map(network => ({
          network,
          htlcContract: config.evm.networks[network].htlcAddress,
          chainId: config.evm.networks[network].chainId,
          supported: true
        }))
      });
    });

    // Error handling
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(config.api.port, () => {
        logger.info(`API server listening on port ${config.api.port}`);
        resolve();
      });
    });
  }
}