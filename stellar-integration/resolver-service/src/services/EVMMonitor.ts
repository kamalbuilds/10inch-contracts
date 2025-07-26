import { ethers } from 'ethers';
import { config } from '../config';
import { HTLC, OrderStatus } from '../types';
import logger from '../utils/logger';
import { EventEmitter } from 'events';

const HTLC_ABI = [
  "event HTLCCreated(bytes32 indexed contractId, address indexed sender, address indexed receiver, uint256 amount, bytes32 hashlock, uint256 timelock)",
  "event HTLCWithdrawn(bytes32 indexed contractId, bytes32 preimage)",
  "event HTLCRefunded(bytes32 indexed contractId)",
  "function getContract(bytes32 _contractId) view returns (address sender, address receiver, uint256 amount, bytes32 hashlock, uint256 timelock, bool withdrawn, bool refunded, bytes32 preimage)",
  "function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32 contractId)",
  "function withdraw(bytes32 _contractId, bytes32 _preimage)",
  "function refund(bytes32 _contractId)"
];

export class EVMMonitor extends EventEmitter {
  private providers: Map<string, ethers.Provider> = new Map();
  private contracts: Map<string, ethers.Contract> = new Map();
  private monitoring: boolean = false;
  private lastBlocks: Map<string, number> = new Map();

  constructor() {
    super();
    this.initializeProviders();
  }

  private initializeProviders() {
    for (const [network, config] of Object.entries(config.evm.networks)) {
      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      this.providers.set(network, provider);
      
      const contract = new ethers.Contract(config.htlcAddress, HTLC_ABI, provider);
      this.contracts.set(network, contract);
    }
  }

  async start() {
    if (this.monitoring) {
      logger.warn('EVM monitor already running');
      return;
    }

    this.monitoring = true;
    logger.info('Starting EVM HTLC monitor...');

    // Start monitoring each network
    for (const network of this.providers.keys()) {
      this.monitorNetwork(network);
    }
  }

  stop() {
    this.monitoring = false;
    logger.info('Stopped EVM HTLC monitor');
  }

  private async monitorNetwork(network: string) {
    const provider = this.providers.get(network)!;
    const contract = this.contracts.get(network)!;

    // Get current block
    const currentBlock = await provider.getBlockNumber();
    this.lastBlocks.set(network, currentBlock);

    // Subscribe to events
    contract.on('HTLCCreated', async (contractId, sender, receiver, amount, hashlock, timelock, event) => {
      await this.handleHTLCCreated(network, {
        contractId,
        sender,
        receiver,
        amount,
        hashlock,
        timelock,
        event
      });
    });

    contract.on('HTLCWithdrawn', async (contractId, preimage, event) => {
      await this.handleHTLCWithdrawn(network, {
        contractId,
        preimage,
        event
      });
    });

    // Also poll for missed events
    this.pollEvents(network);
  }

  private async pollEvents(network: string) {
    const provider = this.providers.get(network)!;
    const contract = this.contracts.get(network)!;

    while (this.monitoring) {
      try {
        const currentBlock = await provider.getBlockNumber();
        const lastBlock = this.lastBlocks.get(network) || currentBlock - 100;

        if (currentBlock > lastBlock) {
          // Query events from last checked block
          const createFilter = contract.filters.HTLCCreated();
          const withdrawFilter = contract.filters.HTLCWithdrawn();

          const [createEvents, withdrawEvents] = await Promise.all([
            contract.queryFilter(createFilter, lastBlock + 1, currentBlock),
            contract.queryFilter(withdrawFilter, lastBlock + 1, currentBlock)
          ]);

          // Process events
          for (const event of createEvents) {
            await this.handleHTLCCreated(network, {
              contractId: event.args![0],
              sender: event.args![1],
              receiver: event.args![2],
              amount: event.args![3],
              hashlock: event.args![4],
              timelock: event.args![5],
              event
            });
          }

          for (const event of withdrawEvents) {
            await this.handleHTLCWithdrawn(network, {
              contractId: event.args![0],
              preimage: event.args![1],
              event
            });
          }

          this.lastBlocks.set(network, currentBlock);
        }

        await new Promise(resolve => setTimeout(resolve, config.resolver.monitoringInterval));
      } catch (error) {
        logger.error(`Error polling events on ${network}:`, error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async handleHTLCCreated(network: string, data: any) {
    logger.info(`New HTLC created on ${network}:`, data);

    const htlc: HTLC = {
      id: data.contractId,
      sender: data.sender,
      receiver: data.receiver,
      amount: BigInt(data.amount.toString()),
      token: 'ETH', // For now, assuming ETH
      hashlock: data.hashlock,
      timelock: Number(data.timelock),
      withdrawn: false,
      refunded: false
    };

    this.emit('htlc:created', {
      chain: network,
      htlc,
      event: data.event
    });
  }

  private async handleHTLCWithdrawn(network: string, data: any) {
    logger.info(`HTLC withdrawn on ${network}:`, data);

    this.emit('htlc:withdrawn', {
      chain: network,
      htlcId: data.contractId,
      secret: data.preimage,
      event: data.event
    });
  }

  async getHTLC(network: string, htlcId: string): Promise<HTLC | null> {
    try {
      const contract = this.contracts.get(network);
      if (!contract) {
        throw new Error(`No contract for network ${network}`);
      }

      const data = await contract.getContract(htlcId);
      
      return {
        id: htlcId,
        sender: data.sender,
        receiver: data.receiver,
        amount: BigInt(data.amount.toString()),
        token: 'ETH',
        hashlock: data.hashlock,
        timelock: Number(data.timelock),
        withdrawn: data.withdrawn,
        refunded: data.refunded,
        secret: data.preimage !== '0x0000000000000000000000000000000000000000000000000000000000000000' 
          ? data.preimage : undefined
      };
    } catch (error) {
      logger.error('Error fetching HTLC:', error);
      return null;
    }
  }
}