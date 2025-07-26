import { Resolver } from './services/Resolver';
import { OrderManager } from './services/OrderManager';
import { APIServer } from './api/server';
import logger from './utils/logger';
import * as cron from 'node-cron';

async function main() {
  try {
    logger.info('Starting Stellar-EVM Resolver Service...');

    // Initialize services
    const orderManager = new OrderManager();
    const resolver = new Resolver();
    const apiServer = new APIServer(resolver, orderManager);

    // Start services
    await orderManager.start();
    await resolver.start();
    await apiServer.start();

    // Schedule periodic tasks
    cron.schedule('*/5 * * * *', async () => {
      logger.info('Running periodic maintenance...');
      await orderManager.expireOldOrders();
    });

    logger.info('Resolver service is running!');

    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
      logger.info('Shutting down resolver service...');
      await resolver.stop();
      await orderManager.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start resolver service:', error);
    process.exit(1);
  }
}

main();