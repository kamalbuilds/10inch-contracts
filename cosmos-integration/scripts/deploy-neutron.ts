import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import { readFileSync } from "fs";
import { join } from "path";
import { config } from 'dotenv';
config();

// Neutron testnet configuration
const NEUTRON_RPC = "https://rpc-falcron.pion-1.ntrn.tech";
const NEUTRON_CHAIN_ID = "pion-1";

// Configuration for contracts
const CONFIG = {
  atomic_swap: {
    protocol_fee_bps: 50, // 0.5%
    min_timelock_duration: 3600, // 1 hour
    max_timelock_duration: 86400, // 24 hours
  },
  cross_chain_bridge: {
    protocol_fee_bps: 50, // 0.5%
    min_timelock_duration: 3600, // 1 hour
    max_timelock_duration: 86400, // 24 hours
    ibc_timeout_seconds: 600, // 10 minutes
    initial_chains: [
      {
        chain_id: 11155111, // Ethereum
        chain_name: "Ethereum Sepolia",
        ibc_channel: "channel-10", // Example channel ID
        fee_multiplier: 100, // 1% additional fee
        is_active: true,
      },
    ],
  },
  resolver: {
    protocol_fee_bps: 50, // 0.5%
    min_safety_deposit: "1000000", // 1 NTRN
    min_timelock_duration: 3600, // 1 hour
    max_timelock_duration: 86400, // 24 hours
    dispute_period: 7200, // 2 hours
  },
};

async function deploy() {
  // Get mnemonic from environment or use a test mnemonic
  const mnemonic = process.env.COSMOS_MNEMONIC || 
    "banner spread envelope side kite person disagree path silver will brother under couch edit food venture squirrel civil budget number acquire point work mass";
  
  // Create wallet
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: "neutron",
  });
  
  const [account] = await wallet.getAccounts();
  console.log(`Using account: ${account.address}`);
  
  // Create client
  const client = await SigningCosmWasmClient.connectWithSigner(
    NEUTRON_RPC,
    wallet,
    {
      gasPrice: GasPrice.fromString("0.025untrn"),
    }
  );
  
  // Check balance
  const balance = await client.getBalance(account.address, "untrn");
  console.log(`Balance: ${balance.amount} untrn`);
  
  if (parseInt(balance.amount) < 4000000) {
    console.error("Insufficient balance. Need at least 4 NTRN for deployment.");
    console.log("Get testnet tokens from:");
    console.log("- Telegram: https://t.me/neutron_faucet_bot");
    console.log("- Discord: https://discord.gg/neutron (use #testnet-faucet channel)");
    return;
  }
  
  const artifactsDir = join(__dirname, "..", "artifacts");
  
  // Deploy atomic swap contract
  console.log("\nDeploying Atomic Swap contract...");
  const atomicSwapWasm = readFileSync(join(artifactsDir, "cosmos_atomic_swap.wasm"));
  
  const atomicSwapUpload = await client.upload(
    account.address,
    atomicSwapWasm,
    "auto"
  );
  console.log(`Atomic Swap code ID: ${atomicSwapUpload.codeId}`);
  
  const atomicSwapInstantiate = await client.instantiate(
    account.address,
    atomicSwapUpload.codeId,
    CONFIG.atomic_swap,
    "1inch Fusion+ Atomic Swap",
    "auto"
  );
  console.log(`Atomic Swap address: ${atomicSwapInstantiate.contractAddress}`);
  
  // Deploy cross-chain bridge contract
  console.log("\nDeploying Cross-Chain Bridge contract...");
  const bridgeWasm = readFileSync(join(artifactsDir, "cosmos_cross_chain_bridge.wasm"));
  
  const bridgeUpload = await client.upload(
    account.address,
    bridgeWasm,
    "auto"
  );
  console.log(`Bridge code ID: ${bridgeUpload.codeId}`);
  
  const bridgeInstantiate = await client.instantiate(
    account.address,
    bridgeUpload.codeId,
    CONFIG.cross_chain_bridge,
    "1inch Fusion+ Cross-Chain Bridge",
    "auto"
  );
  console.log(`Bridge address: ${bridgeInstantiate.contractAddress}`);
  
  // Deploy resolver contract
  console.log("\nDeploying Resolver contract...");
  const resolverWasm = readFileSync(join(artifactsDir, "cosmos_resolver.wasm"));
  
  const resolverUpload = await client.upload(
    account.address,
    resolverWasm,
    "auto"
  );
  console.log(`Resolver code ID: ${resolverUpload.codeId}`);
  
  const resolverInstantiate = await client.instantiate(
    account.address,
    resolverUpload.codeId,
    CONFIG.resolver,
    "1inch Fusion+ Resolver",
    "auto"
  );
  console.log(`Resolver address: ${resolverInstantiate.contractAddress}`);
  
  // Save deployment info
  const deploymentInfo = {
    network: "neutron-testnet",
    chainId: NEUTRON_CHAIN_ID,
    rpc: NEUTRON_RPC,
    deployer: account.address,
    contracts: {
      atomicSwap: {
        codeId: atomicSwapUpload.codeId,
        address: atomicSwapInstantiate.contractAddress,
        txHash: atomicSwapInstantiate.transactionHash,
      },
      crossChainBridge: {
        codeId: bridgeUpload.codeId,
        address: bridgeInstantiate.contractAddress,
        txHash: bridgeInstantiate.transactionHash,
      },
      resolver: {
        codeId: resolverUpload.codeId,
        address: resolverInstantiate.contractAddress,
        txHash: resolverInstantiate.transactionHash,
      },
    },
    timestamp: new Date().toISOString(),
  };
  
  console.log("\n=== Deployment Summary ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // Save to file
  const fs = await import("fs/promises");
  await fs.writeFile(
    join(__dirname, "..", "deployment-neutron.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nDeployment info saved to deployment-neutron.json");
  
  // Test the contracts
  console.log("\n=== Testing Contracts ===");
  
  // Query atomic swap config
  const atomicSwapConfig = await client.queryContractSmart(
    atomicSwapInstantiate.contractAddress,
    { config: {} }
  );
  console.log("Atomic Swap config:", atomicSwapConfig);
  
  // Query bridge config
  const bridgeConfig = await client.queryContractSmart(
    bridgeInstantiate.contractAddress,
    { config: {} }
  );
  console.log("Bridge config:", bridgeConfig);
  
  // Query resolver config
  const resolverConfig = await client.queryContractSmart(
    resolverInstantiate.contractAddress,
    { config: {} }
  );
  console.log("Resolver config:", resolverConfig);
}

// Run deployment
deploy().catch(console.error);