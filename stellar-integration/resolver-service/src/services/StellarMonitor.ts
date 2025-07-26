import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config';
import { HTLC, OrderStatus } from '../types';
import logger from '../utils/logger';
import { EventEmitter } from 'events';

export class StellarMonitor extends EventEmitter {
  private server: StellarSdk.Horizon.Server;
  private htlcContract: string;
  private lastLedger: number = 0;
  private monitoring: boolean = false;

  constructor() {
    super();
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
    this.htlcContract = config.stellar.htlcContractId;
  }

  async start() {
    if (this.monitoring) {
      logger.warn('Stellar monitor already running');
      return;
    }

    this.monitoring = true;
    logger.info('Starting Stellar HTLC monitor...');

    // Get current ledger
    const ledger = await this.server.ledgers().order('desc').limit(1).call();
    this.lastLedger = ledger.records[0].sequence;

    // Start monitoring
    this.monitorHTLCs();
  }

  stop() {
    this.monitoring = false;
    logger.info('Stopped Stellar HTLC monitor');
  }

  private async monitorHTLCs() {
    while (this.monitoring) {
      try {
        // Get contract events
        const events = await this.getContractEvents();
        
        for (const event of events) {
          if (event.topic === 'htlc_created') {
            await this.handleHTLCCreated(event);
          } else if (event.topic === 'htlc_withdrawn') {
            await this.handleHTLCWithdrawn(event);
          }
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, config.resolver.monitoringInterval));
      } catch (error) {
        logger.error('Error monitoring Stellar HTLCs:', error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s on error
      }
    }
  }

  private async getContractEvents(): Promise<any[]> {
    // In production, this would query Soroban events
    // For now, we'll simulate by checking contract state
    try {
      // Get recent operations
      const operations = await this.server
        .operations()
        .forAccount(this.htlcContract)
        .order('desc')
        .limit(50)
        .call();

      const events: any[] = [];
      
      // Parse operations for contract invocations
      for (const op of operations.records) {
        if (op.type === 'invoke_host_function') {
          // Parse the operation to extract HTLC events
          // This is simplified - real implementation would decode XDR
          events.push({
            topic: 'htlc_created',
            data: op
          });
        }
      }

      return events;
    } catch (error) {
      logger.error('Error fetching contract events:', error);
      return [];
    }
  }

  private async handleHTLCCreated(event: any) {
    logger.info('New HTLC created on Stellar:', event);

    // Parse HTLC details from event
    const htlc: HTLC = {
      id: event.data.id || Date.now().toString(),
      sender: event.data.sender,
      receiver: event.data.receiver,
      amount: BigInt(event.data.amount),
      token: event.data.token,
      hashlock: event.data.hashlock,
      timelock: event.data.timelock,
      withdrawn: false,
      refunded: false
    };

    // Emit event for resolver to handle
    this.emit('htlc:created', {
      chain: 'stellar',
      htlc,
      event
    });
  }

  private async handleHTLCWithdrawn(event: any) {
    logger.info('HTLC withdrawn on Stellar:', event);

    // Extract secret from event
    const secret = event.data.secret;
    const htlcId = event.data.htlc_id;

    // Emit event for resolver to use secret on other chains
    this.emit('htlc:withdrawn', {
      chain: 'stellar',
      htlcId,
      secret,
      event
    });
  }

  async getHTLC(htlcId: string): Promise<HTLC | null> {
    try {
      // Call contract to get HTLC details
      // This would use Soroban RPC in production
      const response = await this.server
        .loadAccount(this.htlcContract)
        .then(account => {
          // Simulate getting HTLC data
          return {
            id: htlcId,
            sender: 'GAD5WVZJM3LQDORES47DEDS4DS5GFE4AWBXWFQ6DBLZT5YMMZKHXZKXM',
            receiver: 'GAD5WVZJM3LQDORES47DEDS4DS5GFE4AWBXWFQ6DBLZT5YMMZKHXZKXM',
            amount: BigInt('1000000000'),
            token: config.stellar.nativeTokenContract,
            hashlock: '0x...',
            timelock: Math.floor(Date.now() / 1000) + 3600,
            withdrawn: false,
            refunded: false
          };
        });

      return response as HTLC;
    } catch (error) {
      logger.error('Error fetching HTLC:', error);
      return null;
    }
  }
}