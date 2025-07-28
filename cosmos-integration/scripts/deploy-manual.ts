import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import { readFileSync } from "fs";
import { join } from "path";
import { config } from 'dotenv';
config();

const NEUTRON_RPC = "https://rpc-falcron.pion-1.ntrn.tech";

async function deployWithWorkaround() {
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
      gasPrice: GasPrice.fromString("0.01untrn"), // Adjusted gas price for Neutron
    }
  );
  
  const balance = await client.getBalance(account.address, "untrn");
  console.log(`Balance: ${balance.amount} untrn (${parseInt(balance.amount) / 1000000} NTRN)`);
  
  // Try a different approach - use a pre-deployed cw20 base contract as a test
  console.log("\n=== Testing with known working contract ===");
  
  // First, let's see if we can instantiate an existing code ID
  try {
    // Try to instantiate from an existing CW20 code ID (commonly available on testnets)
    const testInstantiate = await client.instantiate(
      account.address,
      3, // Common CW20 code ID on many testnets
      {
        name: "Test Token",
        symbol: "TEST",
        decimals: 6,
        initial_balances: [{
          address: account.address,
          amount: "1000000"
        }],
        mint: {
          minter: account.address
        }
      },
      "Test CW20",
      "auto"
    );
    console.log("Test instantiation successful:", testInstantiate.contractAddress);
  } catch (e: any) {
    console.log("Test instantiation failed:", e.message);
  }
  
  // Now let's try deploying our contracts with adjusted parameters
  console.log("\n=== Deploying Contracts ===");
  
  const artifactsDir = join(__dirname, "..", "artifacts");
  
  // Deploy atomic swap with manual gas calculation
  try {
    console.log("\nDeploying Atomic Swap contract...");
    const atomicSwapWasm = readFileSync(join(artifactsDir, "cosmos_atomic_swap.wasm"));
    
    // Try with auto gas calculation
    const atomicSwapUpload = await client.upload(
      account.address,
      atomicSwapWasm,
      "auto"
    );
    console.log(`Atomic Swap code ID: ${atomicSwapUpload.codeId}`);
    
    const atomicSwapInstantiate = await client.instantiate(
      account.address,
      atomicSwapUpload.codeId,
      {
        protocol_fee_bps: 50,
        min_timelock_duration: 3600,
        max_timelock_duration: 86400,
      },
      "1inch Fusion+ Atomic Swap",
      "auto"
    );
    console.log(`Atomic Swap address: ${atomicSwapInstantiate.contractAddress}`);
    
    return {
      atomicSwap: {
        codeId: atomicSwapUpload.codeId,
        address: atomicSwapInstantiate.contractAddress,
      }
    };
  } catch (e: any) {
    console.error("Deployment failed:", e);
    
    // If it's still the reference-types error, we need to use an optimizer
    if (e.message && e.message.includes("reference-types")) {
      console.log("\n=== Important ===");
      console.log("The contracts need to be optimized with the CosmWasm optimizer.");
      console.log("Please follow one of these options:");
      console.log("\n1. Use Docker:");
      console.log("   - Start Docker Desktop");
      console.log("   - Run: ./docker-optimize.sh");
      console.log("\n2. Use rust-optimizer directly:");
      console.log("   - cargo install cosmwasm-rust-optimizer");
      console.log("   - cosmwasm-rust-optimizer contracts/*/Cargo.toml");
      console.log("\n3. Deploy pre-optimized contracts:");
      console.log("   - Download optimized contracts from CI/CD");
      console.log("   - Place in artifacts/ directory");
    }
    
    throw e;
  }
}

deployWithWorkaround().catch(console.error);