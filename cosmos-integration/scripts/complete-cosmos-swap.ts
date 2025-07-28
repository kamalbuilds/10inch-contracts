import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import { config } from 'dotenv';
config();

const NEUTRON_RPC = "https://rpc-falcron.pion-1.ntrn.tech";
const CONTRACTS = {
  atomicSwap: "neutron1tnetwd64jle2xncgkcpuf38sp9xhud7sku6tezjvvwdhvsfv6j3qeqkd53",
  bridge: "neutron1fw9wc9uyf0maluja7ftu25amx9w3yx6lqknvec5gejvz0974nrfq3zqcwz",
  resolver: "neutron1haev26g5d2es97kr8lup59aykf9raeu59w8nhtzr2t4fju0702qstcr42v"
};

async function completeCosmosSwap() {
  console.log("=== Completing Cosmos → Sepolia Swap ===\n");
  
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
  
  // Load test data
  const fs = await import("fs/promises");
  const testData = JSON.parse(
    await fs.readFile("test-cosmos-to-sepolia.json", "utf-8")
  );
  
  const orderId = parseInt(testData.cosmos.orderId);
  const secret = testData.cosmos.secret;
  
  console.log(`Order ID: ${orderId}`);
  console.log(`Secret: ${secret}`);
  console.log(`Secret Hash: ${testData.cosmos.secretHash}\n`);
  
  // Query current order status
  console.log("Querying current order status...");
  const orderQuery = await client.queryContractSmart(
    CONTRACTS.resolver,
    { order: { order_id: orderId } }
  );
  console.log("Order status:", {
    src_deployed: orderQuery.order.src_deployed,
    dst_deployed: orderQuery.order.dst_deployed,
    completed: orderQuery.order.completed,
    cancelled: orderQuery.order.cancelled
  });
  
  if (orderQuery.order.completed) {
    console.log("\nOrder already completed!");
    return;
  }
  
  // Step 1: Simulate resolver deploying destination escrow
  if (!orderQuery.order.dst_deployed) {
    console.log("\n1. Deploying destination escrow (resolver action)...");
    try {
      const deployDstMsg = {
        deploy_dst: {
          order_id: orderId
        }
      };
      
      const deployResult = await client.execute(
        account.address,
        CONTRACTS.resolver,
        deployDstMsg,
        "auto"
      );
      
      console.log(`Destination deployed! Tx: ${deployResult.transactionHash}`);
    } catch (error: any) {
      console.log("Deploy destination failed (might need resolver role):", error.message);
    }
  }
  
  // Step 2: User withdraws by revealing secret
  console.log("\n2. User withdrawing by revealing secret...");
  try {
    const withdrawMsg = {
      withdraw: {
        order_id: orderId,
        secret: secret,
        is_source_chain: false // We're withdrawing on destination (Cosmos)
      }
    };
    
    const withdrawResult = await client.execute(
      account.address,
      CONTRACTS.resolver,
      withdrawMsg,
      "auto"
    );
    
    console.log(`\n✅ Withdrawal successful!`);
    console.log(`Transaction hash: ${withdrawResult.transactionHash}`);
    console.log(`Gas used: ${withdrawResult.gasUsed}`);
    
    // The secret is now revealed on-chain
    console.log("\n=== Secret Revealed on Cosmos ===");
    console.log("The resolver can now use this secret to claim ETH on Sepolia");
    console.log(`Revealed secret: ${secret}`);
    
  } catch (error: any) {
    if (error.message.includes("not authorized")) {
      console.log("\nWithdraw failed: Not authorized (wrong timelock window or wrong user)");
    } else if (error.message.includes("already completed")) {
      console.log("\nOrder already completed!");
    } else {
      console.log("Withdraw error:", error.message);
    }
  }
  
  // Query final order status
  console.log("\nQuerying final order status...");
  const finalOrder = await client.queryContractSmart(
    CONTRACTS.resolver,
    { order: { order_id: orderId } }
  );
  
  console.log("Final order status:", {
    completed: finalOrder.order.completed,
    secret: finalOrder.order.secret
  });
  
  if (finalOrder.order.secret) {
    console.log("\n✅ Swap completed successfully!");
    console.log("Secret revealed on-chain:", finalOrder.order.secret);
    console.log("\nResolver can now claim ETH on Sepolia using this secret");
  }
  
  // Check balance change
  const balance = await client.getBalance(account.address, "untrn");
  console.log(`\nCurrent balance: ${parseInt(balance.amount) / 1000000} NTRN`);
}

// Test Sepolia to Cosmos order creation
async function createSepoliaToCosmosOrder() {
  console.log("\n=== Creating Sepolia → Cosmos Order ===\n");
  
  const mnemonic = process.env.COSMOS_MNEMONIC || 
    "banner spread envelope side kite person disagree path silver will brother under couch edit food venture squirrel civil budget number acquire point work mass";
  
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: "neutron",
  });
  
  const [account] = await wallet.getAccounts();
  const client = await SigningCosmWasmClient.connectWithSigner(
    NEUTRON_RPC,
    wallet,
    {
      gasPrice: GasPrice.fromString("0.01untrn"),
    }
  );
  
  // This would be initiated from Sepolia side
  console.log("In a complete flow:");
  console.log("1. User creates order on Sepolia CosmosResolver contract");
  console.log("2. Resolver monitors Sepolia events");
  console.log("3. Resolver creates matching order on Cosmos");
  console.log("4. User claims NTRN by revealing secret on Cosmos");
  console.log("5. Resolver claims ETH using revealed secret on Sepolia");
  
  // For now, let's query our contract configurations
  const atomicSwapConfig = await client.queryContractSmart(
    CONTRACTS.atomicSwap,
    { config: {} }
  );
  console.log("\nAtomic Swap Config:", atomicSwapConfig);
  
  const bridgeConfig = await client.queryContractSmart(
    CONTRACTS.bridge,
    { config: {} }
  );
  console.log("Bridge Config:", bridgeConfig);
}

// Run the completion
if (require.main === module) {
  completeCosmosSwap()
    .then(() => createSepoliaToCosmosOrder())
    .catch(console.error);
}