import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import { createHash } from "crypto";
import { config } from 'dotenv';
config();

const NEUTRON_RPC = "https://rpc-falcron.pion-1.ntrn.tech";
const CONTRACTS = {
  atomicSwap: "neutron1tnetwd64jle2xncgkcpuf38sp9xhud7sku6tezjvvwdhvsfv6j3qeqkd53",
  bridge: "neutron1fw9wc9uyf0maluja7ftu25amx9w3yx6lqknvec5gejvz0974nrfq3zqcwz",
  resolver: "neutron1haev26g5d2es97kr8lup59aykf9raeu59w8nhtzr2t4fju0702qstcr42v"
};

// Sepolia configuration
const SEPOLIA_CHAIN_ID = 11155111;
const SEPOLIA_RECIPIENT = process.env.SEPOLIA_ADDRESS || "0x742d35Cc6634C0532925a3b844Bc9e7595f6D1aB"; // Example address

async function testCosmosToSepolia() {
  console.log("=== Testing Cosmos to Sepolia Swap ===\n");
  
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
  console.log(`Balance: ${parseInt(balance.amount) / 1000000} NTRN\n`);
  
  // Generate secret for HTLC
  const secret = "mysecret" + Date.now();
  const secretHash = createHash("sha256").update(secret).digest("hex");
  console.log(`Secret: ${secret}`);
  console.log(`Secret Hash: ${secretHash}\n`);
  
  // Test parameters
  const swapAmount = "1000000"; // 1 NTRN
  const safetyDeposit = "500000"; // 0.5 NTRN
  const dstAmount = "1000000000000000"; // 0.001 ETH on Sepolia
  const timelock = 3600; // 1 hour
  
  try {
    // Step 1: Create order on resolver
    console.log("Creating cross-chain order on resolver...");
    const deployMsg = {
      deploy_src: {
        initiator: account.address,
        dst_chain_id: SEPOLIA_CHAIN_ID,
        dst_recipient: SEPOLIA_RECIPIENT,
        dst_token: "0x0000000000000000000000000000000000000000", // ETH
        src_amount: {
          denom: "untrn",
          amount: swapAmount
        },
        dst_amount: dstAmount,
        secret_hash: secretHash,
        safety_deposit: {
          denom: "untrn",
          amount: safetyDeposit
        },
        timelock: timelock
      }
    };
    
    // Send total amount (swap + safety deposit) as single coin
    const totalAmount = (parseInt(swapAmount) + parseInt(safetyDeposit)).toString();
    
    const deployResult = await client.execute(
      account.address,
      CONTRACTS.resolver,
      deployMsg,
      "auto",
      undefined,
      [
        { denom: "untrn", amount: totalAmount }
      ]
    );
    
    console.log(`Transaction hash: ${deployResult.transactionHash}`);
    console.log(`Gas used: ${deployResult.gasUsed}`);
    
    // Extract order ID from events
    let orderId = "unknown";
    try {
      const wasmEvent = deployResult.events.find(e => e.type === "wasm");
      const orderIdAttr = wasmEvent?.attributes.find(a => a.key === "order_id");
      orderId = orderIdAttr?.value || "0";
    } catch (e) {
      console.log("Could not extract order ID from events");
      orderId = "0"; // First order
    }
    console.log(`Order ID: ${orderId}\n`);
    
    // Step 2: Query order details
    console.log("Querying order details...");
    const orderQuery = await client.queryContractSmart(
      CONTRACTS.resolver,
      { order: { order_id: parseInt(orderId) } }
    );
    console.log("Order details:", JSON.stringify(orderQuery, null, 2));
    
    // Step 3: Check escrow address
    console.log("\nQuerying escrow immutables...");
    const escrowQuery = await client.queryContractSmart(
      CONTRACTS.resolver,
      { 
        get_escrow_immutables: { 
          resolver: account.address,
          order_id: parseInt(orderId) 
        } 
      }
    );
    console.log("Escrow details:", JSON.stringify(escrowQuery, null, 2));
    
    console.log("\n=== Next Steps ===");
    console.log("1. Deploy corresponding order on Sepolia using EVM resolver");
    console.log("2. Resolver fills the Sepolia side with ETH");
    console.log("3. User reveals secret on Sepolia to claim ETH");
    console.log("4. Resolver uses secret to claim NTRN on Cosmos");
    console.log("\nSecret to use on Sepolia:", secret);
    console.log("Order ID:", orderId);
    
    // Save test data for later use
    const testData = {
      cosmos: {
        orderId,
        secret,
        secretHash,
        initiator: account.address,
        amount: swapAmount,
        safetyDeposit,
        txHash: deployResult.transactionHash
      },
      sepolia: {
        chainId: SEPOLIA_CHAIN_ID,
        recipient: SEPOLIA_RECIPIENT,
        amount: dstAmount,
        token: "0x0000000000000000000000000000000000000000"
      },
      timestamp: new Date().toISOString()
    };
    
    const fs = await import("fs/promises");
    await fs.writeFile(
      "test-cosmos-to-sepolia.json",
      JSON.stringify(testData, null, 2)
    );
    console.log("\nTest data saved to test-cosmos-to-sepolia.json");
    
  } catch (error: any) {
    console.error("Error:", error.message);
    if (error.logs) {
      console.error("Logs:", error.logs);
    }
  }
}

testCosmosToSepolia().catch(console.error);