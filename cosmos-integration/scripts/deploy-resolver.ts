import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import { readFileSync } from "fs";
import { join } from "path";
import { config } from 'dotenv';
config();

const NEUTRON_RPC = "https://rpc-falcron.pion-1.ntrn.tech";

// Deployed contract addresses from previous deployment
const ATOMIC_SWAP_ADDRESS = "neutron1tnetwd64jle2xncgkcpuf38sp9xhud7sku6tezjvvwdhvsfv6j3qeqkd53";
const BRIDGE_ADDRESS = "neutron1fw9wc9uyf0maluja7ftu25amx9w3yx6lqknvec5gejvz0974nrfq3zqcwz";

async function deployResolver() {
  const mnemonic = process.env.COSMOS_MNEMONIC || 
    "banner spread envelope side kite person disagree path silver will brother under couch edit food venture squirrel civil budget number acquire point work mass";
  
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: "neutron",
  });
  
  const [account] = await wallet.getAccounts();
  console.log(`Using account: ${account.address}`);
  
  const client = await SigningCosmWasmClient.connectWithSigner(
    NEUTRON_RPC,
    wallet,
    {
      gasPrice: GasPrice.fromString("0.01untrn"),
    }
  );
  
  const balance = await client.getBalance(account.address, "untrn");
  console.log(`Balance: ${balance.amount} untrn (${parseInt(balance.amount) / 1000000} NTRN)`);
  
  const artifactsDir = join(__dirname, "..", "artifacts");
  
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
    {
      atomic_swap_contract: ATOMIC_SWAP_ADDRESS,
      bridge_contract: BRIDGE_ADDRESS,
    },
    "1inch Fusion+ Resolver",
    "auto"
  );
  console.log(`Resolver address: ${resolverInstantiate.contractAddress}`);
  
  // Save deployment info
  const deploymentInfo = {
    network: "neutron-testnet",
    chainId: "pion-1",
    rpc: NEUTRON_RPC,
    deployer: account.address,
    contracts: {
      atomicSwap: {
        codeId: 12310,
        address: ATOMIC_SWAP_ADDRESS,
      },
      crossChainBridge: {
        codeId: 12311,
        address: BRIDGE_ADDRESS,
      },
      resolver: {
        codeId: resolverUpload.codeId,
        address: resolverInstantiate.contractAddress,
        txHash: resolverInstantiate.transactionHash,
      },
    },
    timestamp: new Date().toISOString(),
  };
  
  console.log("\n=== Complete Deployment Summary ===");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // Save to file
  const fs = await import("fs/promises");
  await fs.writeFile(
    join(__dirname, "..", "deployment-neutron-complete.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nDeployment info saved to deployment-neutron-complete.json");
  
  // Test the contracts
  console.log("\n=== Testing Contracts ===");
  
  // Query atomic swap config
  const atomicSwapConfig = await client.queryContractSmart(
    ATOMIC_SWAP_ADDRESS,
    { config: {} }
  );
  console.log("Atomic Swap config:", atomicSwapConfig);
  
  // Query bridge config
  const bridgeConfig = await client.queryContractSmart(
    BRIDGE_ADDRESS,
    { config: {} }
  );
  console.log("Bridge config:", bridgeConfig);
  
  // Query resolver state
  const resolverContracts = await client.queryContractSmart(
    resolverInstantiate.contractAddress,
    { contracts: {} }
  );
  console.log("Resolver contracts:", resolverContracts);
}

deployResolver().catch(console.error);