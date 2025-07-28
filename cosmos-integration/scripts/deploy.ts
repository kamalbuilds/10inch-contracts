import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { GasPrice } from '@cosmjs/stargate';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
config();

interface DeployConfig {
  mnemonic: string;
  rpcEndpoint: string;
  prefix: string;
  gasPrice: string;
  protocolFeeBps: number;
  minTimelockDuration: number;
  maxTimelockDuration: number;
  ibcTimeoutSeconds: number;
  initialChains: Array<{
    chainId: number;
    chainName: string;
    ibcChannel: string;
    isActive: boolean;
    feeMultiplier: number;
  }>;
}

async function deployContracts(config: DeployConfig) {
  console.log('Setting up wallet...');
  console.log(config);
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(config.mnemonic, {
    prefix: config.prefix,
  });

  const [account] = await wallet.getAccounts();
  console.log(`Deploying from address: ${account.address}`);

  console.log('Connecting to chain...');
  const client = await SigningCosmWasmClient.connectWithSigner(
    config.rpcEndpoint,
    wallet,
    {
      gasPrice: GasPrice.fromString(config.gasPrice),
    }
  );

  // Deploy Atomic Swap Contract
  console.log('Deploying Atomic Swap contract...');
  const atomicSwapWasm = readFileSync(
    join(__dirname, '../artifacts/cosmos_atomic_swap.wasm')
  );
  
  const atomicSwapUploadResult = await client.upload(
    account.address,
    atomicSwapWasm,
    'auto'
  );
  console.log(`Atomic Swap code ID: ${atomicSwapUploadResult.codeId}`);

  const atomicSwapInstantiateMsg = {
    protocol_fee_bps: config.protocolFeeBps,
    min_timelock_duration: config.minTimelockDuration,
    max_timelock_duration: config.maxTimelockDuration,
  };

  const atomicSwapInstantiateResult = await client.instantiate(
    account.address,
    atomicSwapUploadResult.codeId,
    atomicSwapInstantiateMsg,
    'Cosmos Atomic Swap',
    'auto'
  );
  console.log(`Atomic Swap contract address: ${atomicSwapInstantiateResult.contractAddress}`);

  // Deploy Cross-Chain Bridge Contract
  console.log('Deploying Cross-Chain Bridge contract...');
  const bridgeWasm = readFileSync(
    join(__dirname, '../artifacts/cosmos_cross_chain_bridge.wasm')
  );
  
  const bridgeUploadResult = await client.upload(
    account.address,
    bridgeWasm,
    'auto'
  );
  console.log(`Bridge code ID: ${bridgeUploadResult.codeId}`);

  const bridgeInstantiateMsg = {
    protocol_fee_bps: config.protocolFeeBps,
    min_timelock_duration: config.minTimelockDuration,
    max_timelock_duration: config.maxTimelockDuration,
    ibc_timeout_seconds: config.ibcTimeoutSeconds,
    initial_chains: config.initialChains.map(chain => ({
      chain_id: chain.chainId,
      chain_name: chain.chainName,
      ibc_channel: chain.ibcChannel,
      is_active: chain.isActive,
      fee_multiplier: chain.feeMultiplier,
    })),
  };

  const bridgeInstantiateResult = await client.instantiate(
    account.address,
    bridgeUploadResult.codeId,
    bridgeInstantiateMsg,
    'Cosmos Cross-Chain Bridge',
    'auto'
  );
  console.log(`Bridge contract address: ${bridgeInstantiateResult.contractAddress}`);

  // Deploy Resolver Contract
  console.log('Deploying Resolver contract...');
  const resolverWasm = readFileSync(
    join(__dirname, '../artifacts/cosmos_resolver.wasm')
  );
  
  const resolverUploadResult = await client.upload(
    account.address,
    resolverWasm,
    'auto'
  );
  console.log(`Resolver code ID: ${resolverUploadResult.codeId}`);

  const resolverInstantiateMsg = {
    atomic_swap_contract: atomicSwapInstantiateResult.contractAddress,
    bridge_contract: bridgeInstantiateResult.contractAddress,
  };

  const resolverInstantiateResult = await client.instantiate(
    account.address,
    resolverUploadResult.codeId,
    resolverInstantiateMsg,
    'Cosmos Resolver',
    'auto'
  );
  console.log(`Resolver contract address: ${resolverInstantiateResult.contractAddress}`);

  // Save deployment info
  const deploymentInfo = {
    atomicSwap: {
      codeId: atomicSwapUploadResult.codeId,
      address: atomicSwapInstantiateResult.contractAddress,
      txHash: atomicSwapInstantiateResult.transactionHash,
    },
    bridge: {
      codeId: bridgeUploadResult.codeId,
      address: bridgeInstantiateResult.contractAddress,
      txHash: bridgeInstantiateResult.transactionHash,
    },
    resolver: {
      codeId: resolverUploadResult.codeId,
      address: resolverInstantiateResult.contractAddress,
      txHash: resolverInstantiateResult.transactionHash,
    },
    deployer: account.address,
    timestamp: new Date().toISOString(),
  };

  console.log('\nDeployment complete!');
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // Write deployment info to file for easy reference
  const fs = require('fs');
  fs.writeFileSync(
    join(__dirname, '../deployment-info.json'),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log('\n📝 Update your .env file with these addresses:');
  console.log(`COSMOS_ATOMIC_SWAP_CONTRACT=${atomicSwapInstantiateResult.contractAddress}`);
  console.log(`COSMOS_BRIDGE_CONTRACT=${bridgeInstantiateResult.contractAddress}`);
  console.log(`COSMOS_RESOLVER_CONTRACT=${resolverInstantiateResult.contractAddress}`);

  return deploymentInfo;
}

// Example usage
if (require.main === module) {
  const config: DeployConfig = {
    mnemonic: process.env.COSMOS_MNEMONIC || 'your mnemonic here',
    rpcEndpoint: process.env.COSMOS_RPC_ENDPOINT || 'https://rpc-palvus.pion-1.ntrn.tech',
    prefix: 'neutron',
    gasPrice: '0.025untrn',
    protocolFeeBps: 50, // 0.5%
    minTimelockDuration: 3600, // 1 hour
    maxTimelockDuration: 86400, // 24 hours
    ibcTimeoutSeconds: 600, // 10 minutes
    initialChains: [
      {
        chainId: 11155111,
        chainName: 'Ethereum Sepolia',
        ibcChannel: 'channel-0',
        isActive: true,
        feeMultiplier: 100, // 1% extra for Ethereum
      },
      {
        chainId: 56,
        chainName: 'BSC',
        ibcChannel: 'channel-1',
        isActive: true,
        feeMultiplier: 50, // 0.5% extra for BSC
      },
      {
        chainId: 80001,
        chainName: 'Polygon Mumbai',
        ibcChannel: 'channel-2',
        isActive: true,
        feeMultiplier: 25, // 0.25% extra for Polygon
      },
    ],
  };

  deployContracts(config)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Deployment failed:', error);
      process.exit(1);
    });
}

export { deployContracts };