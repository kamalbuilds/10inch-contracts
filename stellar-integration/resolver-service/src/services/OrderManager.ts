import { createClient, RedisClientType } from 'redis';
import { config } from '../config';
import { CrossChainOrder, OrderStatus } from '../types';
import logger from '../utils/logger';

export class OrderManager {
  private redis: RedisClientType;
  private connected: boolean = false;

  constructor() {
    this.redis = createClient({
      url: config.redis.url
    });

    this.redis.on('error', (err) => {
      logger.error('Redis Client Error:', err);
    });
  }

  async start() {
    if (!this.connected) {
      await this.redis.connect();
      this.connected = true;
      logger.info('Order manager connected to Redis');
    }
  }

  async stop() {
    if (this.connected) {
      await this.redis.disconnect();
      this.connected = false;
      logger.info('Order manager disconnected from Redis');
    }
  }

  async createOrder(order: CrossChainOrder): Promise<void> {
    const key = `order:${order.id}`;
    await this.redis.set(key, JSON.stringify(order), {
      EX: 86400 // Expire after 24 hours
    });

    // Also index by chain and HTLC ID
    await this.redis.set(
      `htlc:${order.sourceChain}:${order.sourceHTLC.id}`,
      order.id,
      { EX: 86400 }
    );

    logger.info(`Created order ${order.id}`);
  }

  async updateOrder(order: CrossChainOrder): Promise<void> {
    order.updatedAt = new Date();
    const key = `order:${order.id}`;
    await this.redis.set(key, JSON.stringify(order), {
      EX: 86400
    });

    logger.info(`Updated order ${order.id} to status ${order.status}`);
  }

  async getOrder(orderId: string): Promise<CrossChainOrder | null> {
    const key = `order:${orderId}`;
    const data = await this.redis.get(key);
    
    if (!data) {
      return null;
    }

    return JSON.parse(data) as CrossChainOrder;
  }

  async findOrderByHTLC(chain: string, htlcId: string): Promise<CrossChainOrder | null> {
    const orderId = await this.redis.get(`htlc:${chain}:${htlcId}`);
    
    if (!orderId) {
      return null;
    }

    return this.getOrder(orderId);
  }

  async getActiveOrders(): Promise<CrossChainOrder[]> {
    const keys = await this.redis.keys('order:*');
    const orders: CrossChainOrder[] = [];

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const order = JSON.parse(data) as CrossChainOrder;
        if (order.status !== OrderStatus.COMPLETED && 
            order.status !== OrderStatus.FAILED &&
            order.status !== OrderStatus.EXPIRED) {
          orders.push(order);
        }
      }
    }

    return orders;
  }

  async expireOldOrders(): Promise<void> {
    const orders = await this.getActiveOrders();
    const now = Date.now();

    for (const order of orders) {
      if (order.sourceHTLC.timelock * 1000 < now) {
        order.status = OrderStatus.EXPIRED;
        await this.updateOrder(order);
        logger.info(`Expired order ${order.id}`);
      }
    }
  }

  async getMetrics(): Promise<any> {
    const keys = await this.redis.keys('order:*');
    let totalOrders = 0;
    let completedOrders = 0;
    let failedOrders = 0;
    let totalVolume = BigInt(0);

    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const order = JSON.parse(data) as CrossChainOrder;
        totalOrders++;
        
        if (order.status === OrderStatus.COMPLETED) {
          completedOrders++;
          totalVolume += BigInt(order.sourceHTLC.amount);
        } else if (order.status === OrderStatus.FAILED) {
          failedOrders++;
        }
      }
    }

    return {
      totalOrders,
      completedOrders,
      failedOrders,
      totalVolume: totalVolume.toString(),
      successRate: totalOrders > 0 ? completedOrders / totalOrders : 0
    };
  }
}