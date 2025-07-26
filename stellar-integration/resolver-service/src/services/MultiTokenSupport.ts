import { TokenRegistry, TokenInfo } from '../../../token-registry/src/TokenRegistry';
import { ethers } from 'ethers';
import * as StellarSdk from '@stellar/stellar-sdk';
import { config } from '../config';
import logger from '../utils/logger';

export class MultiTokenSupport {
  private tokenRegistry: TokenRegistry;
  private tokenContracts: Map<string, any> = new Map();

  constructor() {
    this.tokenRegistry = new TokenRegistry();
    this.initializeTokenContracts();
  }

  private initializeTokenContracts() {
    // Initialize ERC20 contract interfaces for EVM chains
    const erc20ABI = [
      'function balanceOf(address account) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
      'function name() view returns (string)'
    ];

    // Store ABI for later use
    this.tokenContracts.set('ERC20_ABI', erc20ABI);
  }

  async createHTLCWithToken(
    chain: string,
    htlcContract: string,
    sender: string,
    receiver: string,
    token: TokenInfo,
    amount: bigint,
    hashlock: string,
    timelock: number,
    signer: any
  ): Promise<string> {
    if (chain === 'stellar') {
      return this.createStellarHTLCWithToken(
        htlcContract,
        sender,
        receiver,
        token,
        amount,
        hashlock,
        timelock
      );
    } else {
      return this.createEVMHTLCWithToken(
        chain,
        htlcContract,
        sender,
        receiver,
        token,
        amount,
        hashlock,
        timelock,
        signer
      );
    }
  }

  private async createStellarHTLCWithToken(
    htlcContract: string,
    sender: string,
    receiver: string,
    token: TokenInfo,
    amount: bigint,
    hashlock: string,
    timelock: number
  ): Promise<string> {
    const { execSync } = require('child_process');
    
    // For native XLM, use the standard HTLC
    // For other tokens, use multi-token HTLC
    const command = `stellar contract invoke \
      --id ${htlcContract} \
      --source deployer \
      --network testnet \
      -- create_htlc \
      --sender ${sender} \
      --receiver ${receiver} \
      --token ${token.address} \
      --amount ${amount} \
      --hashlock ${hashlock} \
      --timelock ${timelock}`;
    
    const result = execSync(command, { encoding: 'utf-8' });
    return result.trim();
  }

  private async createEVMHTLCWithToken(
    chain: string,
    htlcContract: string,
    sender: string,
    receiver: string,
    token: TokenInfo,
    amount: bigint,
    hashlock: string,
    timelock: number,
    signer: ethers.Signer
  ): Promise<string> {
    // Check if it's ETH or ERC20
    if (token.address === '0x0000000000000000000000000000000000000000') {
      // Native ETH
      const htlcABI = [
        'function createHTLC(address _receiver, bytes32 _hashlock, uint256 _timelock) payable returns (bytes32)'
      ];
      
      const contract = new ethers.Contract(htlcContract, htlcABI, signer);
      const tx = await contract.createHTLC(receiver, hashlock, timelock, { value: amount });
      const receipt = await tx.wait();
      
      // Extract HTLC ID from event
      return receipt.logs[0].topics[1];
    } else {
      // ERC20 token
      const htlcABI = [
        'function createHTLCWithToken(address _token, address _receiver, uint256 _amount, bytes32 _hashlock, uint256 _timelock) returns (bytes32)'
      ];
      
      // First approve token transfer
      const tokenContract = new ethers.Contract(
        token.address,
        this.tokenContracts.get('ERC20_ABI'),
        signer
      );
      
      const approveTx = await tokenContract.approve(htlcContract, amount);
      await approveTx.wait();
      
      // Create HTLC
      const contract = new ethers.Contract(htlcContract, htlcABI, signer);
      const tx = await contract.createHTLCWithToken(
        token.address,
        receiver,
        amount,
        hashlock,
        timelock
      );
      const receipt = await tx.wait();
      
      return receipt.logs[0].topics[1];
    }
  }

  async getTokenBalance(
    chain: string,
    tokenAddress: string,
    accountAddress: string,
    provider?: any
  ): Promise<bigint> {
    const token = this.tokenRegistry.getTokenByAddress(chain, tokenAddress);
    if (!token) {
      throw new Error(`Unknown token: ${tokenAddress} on ${chain}`);
    }

    if (chain === 'stellar') {
      return this.getStellarTokenBalance(token, accountAddress);
    } else {
      return this.getEVMTokenBalance(token, accountAddress, provider);
    }
  }

  private async getStellarTokenBalance(
    token: TokenInfo,
    accountAddress: string
  ): Promise<bigint> {
    const server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
    
    try {
      const account = await server.loadAccount(accountAddress);
      
      if (token.symbol === 'XLM') {
        // Native XLM balance
        const xlmBalance = account.balances.find(b => b.asset_type === 'native');
        if (xlmBalance) {
          return BigInt(Math.floor(parseFloat(xlmBalance.balance) * Math.pow(10, token.decimals)));
        }
      } else {
        // Other assets
        const assetBalance = account.balances.find(
          b => b.asset_type !== 'native' && 
               b.asset_issuer === token.address
        );
        if (assetBalance) {
          return BigInt(Math.floor(parseFloat(assetBalance.balance) * Math.pow(10, token.decimals)));
        }
      }
      
      return BigInt(0);
    } catch (error) {
      logger.error('Error getting Stellar balance:', error);
      return BigInt(0);
    }
  }

  private async getEVMTokenBalance(
    token: TokenInfo,
    accountAddress: string,
    provider: ethers.Provider
  ): Promise<bigint> {
    if (token.address === '0x0000000000000000000000000000000000000000') {
      // Native ETH
      return await provider.getBalance(accountAddress);
    } else {
      // ERC20 token
      const contract = new ethers.Contract(
        token.address,
        this.tokenContracts.get('ERC20_ABI'),
        provider
      );
      return await contract.balanceOf(accountAddress);
    }
  }

  getTokenRegistry(): TokenRegistry {
    return this.tokenRegistry;
  }

  async estimateSwapRate(
    sourceChain: string,
    targetChain: string,
    sourceToken: string,
    targetToken: string,
    amount: bigint
  ): Promise<{ rate: number; targetAmount: bigint }> {
    const source = this.tokenRegistry.getTokenByAddress(sourceChain, sourceToken);
    const target = this.tokenRegistry.getTokenByAddress(targetChain, targetToken);

    if (!source || !target) {
      throw new Error('Unknown token');
    }

    // Get price from oracle (simplified)
    // In production, this would use real price feeds
    const rates: { [key: string]: number } = {
      'XLM': 0.10,
      'ETH': 2000,
      'USDC': 1,
      'USDT': 1,
      'wETH': 2000,
      'WETH': 2000
    };

    const sourcePrice = rates[source.symbol] || 0;
    const targetPrice = rates[target.symbol] || 0;

    if (sourcePrice === 0 || targetPrice === 0) {
      throw new Error('No price data');
    }

    const rate = sourcePrice / targetPrice;
    
    // Convert amount considering decimals
    const sourceAmountNormalized = Number(amount) / Math.pow(10, source.decimals);
    const targetAmountNormalized = sourceAmountNormalized * rate * 0.99; // 1% slippage
    const targetAmount = BigInt(Math.floor(targetAmountNormalized * Math.pow(10, target.decimals)));

    return { rate, targetAmount };
  }
}