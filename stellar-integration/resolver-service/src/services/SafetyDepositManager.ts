import { ethers } from 'ethers';
import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config';
import { Token } from '../types';
import logger from '../utils/logger';

interface DepositRequirement {
  chain: string;
  minDeposit: bigint;
  currentDeposit: bigint;
  lockedAmount: bigint;
  availableAmount: bigint;
}

export class SafetyDepositManager {
  private deposits: Map<string, DepositRequirement> = new Map();
  private stellarDepositContract?: string;
  private evmDepositContracts: Map<string, ethers.Contract> = new Map();

  constructor() {
    this.initializeDepositContracts();
  }

  private initializeDepositContracts() {
    // Initialize EVM deposit contracts
    const depositABI = [
      'function deposit(address token, uint256 amount) payable',
      'function withdraw(address token, uint256 amount)',
      'function getDeposit(address resolver, address token) view returns (uint256)',
      'function lockDeposit(address resolver, uint256 amount)',
      'function unlockDeposit(address resolver, uint256 amount)',
      'function slashDeposit(address resolver, uint256 amount, address recipient)'
    ];

    for (const [network, networkConfig] of Object.entries(config.evm.networks)) {
      if (networkConfig.depositContract) {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
        const signer = new ethers.Wallet(networkConfig.resolverPrivateKey, provider);
        const contract = new ethers.Contract(
          networkConfig.depositContract,
          depositABI,
          signer
        );
        this.evmDepositContracts.set(network, contract);
      }
    }

    // Set Stellar deposit contract
    this.stellarDepositContract = config.stellar.depositContract;
  }

  /**
   * Calculate required deposit for an order
   */
  calculateRequiredDeposit(
    orderAmount: bigint,
    chain: string,
    riskFactor: number = 1.0
  ): bigint {
    const baseMultiplier = config.resolver.safetyDepositMultiplier;
    const adjustedMultiplier = baseMultiplier * riskFactor;
    
    return BigInt(Math.floor(Number(orderAmount) * adjustedMultiplier));
  }

  /**
   * Check if resolver has sufficient deposit
   */
  async checkDeposit(
    chain: string,
    token: string,
    requiredAmount: bigint
  ): Promise<boolean> {
    const currentDeposit = await this.getDeposit(chain, token);
    const deposit = this.deposits.get(`${chain}:${token}`) || {
      chain,
      minDeposit: requiredAmount,
      currentDeposit,
      lockedAmount: BigInt(0),
      availableAmount: currentDeposit
    };

    return deposit.availableAmount >= requiredAmount;
  }

  /**
   * Get current deposit amount
   */
  async getDeposit(chain: string, token: string): Promise<bigint> {
    try {
      if (chain === 'stellar') {
        return this.getStellarDeposit(token);
      } else {
        return this.getEVMDeposit(chain, token);
      }
    } catch (error) {
      logger.error(`Error getting deposit for ${chain}:${token}:`, error);
      return BigInt(0);
    }
  }

  private async getStellarDeposit(token: string): Promise<bigint> {
    if (!this.stellarDepositContract) {
      return BigInt(0);
    }

    const { execSync } = require('child_process');
    
    try {
      const command = `stellar contract invoke \
        --id ${this.stellarDepositContract} \
        --network testnet \
        -- get_deposit \
        --resolver ${config.stellar.resolverAddress}`;
      
      const result = execSync(command, { encoding: 'utf-8' });
      return BigInt(result.trim());
    } catch (error) {
      logger.error('Error getting Stellar deposit:', error);
      return BigInt(0);
    }
  }

  private async getEVMDeposit(chain: string, token: string): Promise<bigint> {
    const contract = this.evmDepositContracts.get(chain);
    if (!contract) {
      return BigInt(0);
    }

    try {
      const resolverAddress = await contract.signer.getAddress();
      return await contract.getDeposit(resolverAddress, token);
    } catch (error) {
      logger.error(`Error getting EVM deposit for ${chain}:`, error);
      return BigInt(0);
    }
  }

  /**
   * Make a deposit
   */
  async makeDeposit(
    chain: string,
    token: string,
    amount: bigint
  ): Promise<boolean> {
    try {
      logger.info(`Making deposit of ${amount} on ${chain}`);

      if (chain === 'stellar') {
        return this.makeStellarDeposit(token, amount);
      } else {
        return this.makeEVMDeposit(chain, token, amount);
      }
    } catch (error) {
      logger.error('Error making deposit:', error);
      return false;
    }
  }

  private async makeStellarDeposit(token: string, amount: bigint): Promise<boolean> {
    if (!this.stellarDepositContract) {
      throw new Error('Stellar deposit contract not configured');
    }

    const { execSync } = require('child_process');
    
    const command = `stellar contract invoke \
      --id ${this.stellarDepositContract} \
      --source deployer \
      --network testnet \
      -- deposit_collateral \
      --resolver ${config.stellar.resolverAddress} \
      --token ${token} \
      --amount ${amount}`;
    
    execSync(command, { encoding: 'utf-8' });
    
    // Update local tracking
    const key = `stellar:${token}`;
    const current = this.deposits.get(key) || {
      chain: 'stellar',
      minDeposit: BigInt(0),
      currentDeposit: BigInt(0),
      lockedAmount: BigInt(0),
      availableAmount: BigInt(0)
    };
    
    current.currentDeposit += amount;
    current.availableAmount += amount;
    this.deposits.set(key, current);
    
    return true;
  }

  private async makeEVMDeposit(
    chain: string,
    token: string,
    amount: bigint
  ): Promise<boolean> {
    const contract = this.evmDepositContracts.get(chain);
    if (!contract) {
      throw new Error(`No deposit contract for ${chain}`);
    }

    let tx;
    if (token === '0x0000000000000000000000000000000000000000') {
      // ETH deposit
      tx = await contract.deposit(token, amount, { value: amount });
    } else {
      // ERC20 deposit - need approval first
      const tokenContract = new ethers.Contract(
        token,
        ['function approve(address spender, uint256 amount) returns (bool)'],
        contract.signer
      );
      
      const approveTx = await tokenContract.approve(contract.address, amount);
      await approveTx.wait();
      
      tx = await contract.deposit(token, amount);
    }
    
    await tx.wait();
    
    // Update local tracking
    const key = `${chain}:${token}`;
    const current = this.deposits.get(key) || {
      chain,
      minDeposit: BigInt(0),
      currentDeposit: BigInt(0),
      lockedAmount: BigInt(0),
      availableAmount: BigInt(0)
    };
    
    current.currentDeposit += amount;
    current.availableAmount += amount;
    this.deposits.set(key, current);
    
    return true;
  }

  /**
   * Lock deposit for an order
   */
  async lockDeposit(
    chain: string,
    token: string,
    amount: bigint,
    orderId: string
  ): Promise<boolean> {
    const key = `${chain}:${token}`;
    const deposit = this.deposits.get(key);
    
    if (!deposit || deposit.availableAmount < amount) {
      return false;
    }
    
    deposit.lockedAmount += amount;
    deposit.availableAmount -= amount;
    this.deposits.set(key, deposit);
    
    logger.info(`Locked ${amount} for order ${orderId}`);
    return true;
  }

  /**
   * Unlock deposit after order completion
   */
  async unlockDeposit(
    chain: string,
    token: string,
    amount: bigint,
    orderId: string
  ): Promise<boolean> {
    const key = `${chain}:${token}`;
    const deposit = this.deposits.get(key);
    
    if (!deposit) {
      return false;
    }
    
    deposit.lockedAmount -= amount;
    deposit.availableAmount += amount;
    this.deposits.set(key, deposit);
    
    logger.info(`Unlocked ${amount} for order ${orderId}`);
    return true;
  }

  /**
   * Calculate deposit APY based on performance
   */
  calculateDepositAPY(
    successRate: number,
    totalVolume: bigint,
    depositAmount: bigint
  ): number {
    // Base APY
    let apy = 0.05; // 5% base
    
    // Performance bonus
    if (successRate > 0.95) {
      apy += 0.02; // +2% for >95% success
    }
    
    // Volume bonus
    const volumeRatio = Number(totalVolume / depositAmount);
    if (volumeRatio > 100) {
      apy += 0.03; // +3% for high volume
    }
    
    return Math.min(apy, 0.15); // Cap at 15%
  }

  /**
   * Get deposit statistics
   */
  getDepositStats(): {
    totalDeposited: bigint;
    totalLocked: bigint;
    totalAvailable: bigint;
    byChain: Map<string, DepositRequirement>;
  } {
    let totalDeposited = BigInt(0);
    let totalLocked = BigInt(0);
    let totalAvailable = BigInt(0);
    
    for (const deposit of this.deposits.values()) {
      totalDeposited += deposit.currentDeposit;
      totalLocked += deposit.lockedAmount;
      totalAvailable += deposit.availableAmount;
    }
    
    return {
      totalDeposited,
      totalLocked,
      totalAvailable,
      byChain: this.deposits
    };
  }
}