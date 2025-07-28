import { ethers } from 'ethers';
import * as fs from 'fs';
import { config } from 'dotenv';
config();

// Configuration
const SEPOLIA_RPC = process.env.SEPOLIA_RPC!;
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY!;
const RESOLVER_ADDRESS = "0xA2fbe4f2Fce35620c40f21f1B1B507a44682706a";
const CHAIN_ID_COSMOS_NEUTRON = 1;

// Contract ABI
const COSMOS_RESOLVER_ABI = [
  "constructor()",
  "function createOrder(uint32 dstChainId, string calldata dstRecipient, address token, uint256 amount, bytes32 secretHash, uint256 timelock) external payable returns (uint256)",
  "function fillOrder(uint256 orderId, uint256 safetyDeposit) external payable",
  "function deployDstEscrow(uint256 orderId, string calldata cosmosOrderId, tuple(string orderHash, uint32 srcChainId, uint32 dstChainId, string srcToken, string dstToken, string srcAmount, string dstAmount, address resolver, string beneficiary, bytes32 secretHash, uint256 finalityTimestamp, uint256 resolverTimestamp, uint256 beneficiaryTimestamp, uint256 safetyDeposit) calldata immutables) external",
  "function withdraw(uint256 orderId, bytes32 secret) external",
  "function cancel(uint256 orderId) external",
  "function getOrder(uint256 orderId) external view returns (tuple(uint256 orderId, address initiator, address resolver, uint32 srcChainId, uint32 dstChainId, address token, uint256 amount, string dstRecipient, bytes32 secretHash, uint256 timelock, uint256 safetyDeposit, bool srcDeployed, bool dstDeployed, bool completed, bool cancelled))",
  "function canWithdraw(uint256 orderId, address user) external view returns (bool)",
  "function verifySecret(bytes32 secret, bytes32 secretHash) external pure returns (bool)",
  "event OrderCreated(uint256 indexed orderId, address indexed initiator, address indexed resolver, uint32 dstChainId, string dstRecipient, bytes32 secretHash, uint256 amount, uint256 timelock)",
  "event DstEscrowDeployed(uint256 indexed orderId, address indexed resolver, string cosmosOrderId, uint256 amount, bytes32 secretHash)",
  "event Withdrawn(uint256 indexed orderId, address indexed user, uint256 amount, bytes32 secret)",
  "event Cancelled(uint256 indexed orderId, address indexed user, uint256 amount)"
];

async function createSepoliaToCosmosOrder() {
  console.log("=== Creating Sepolia → Cosmos Order ===\n");
  
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const resolver = new ethers.Contract(RESOLVER_ADDRESS, COSMOS_RESOLVER_ABI, wallet);
  
  // Order parameters
  const cosmosRecipient = "neutron1njzwck6re79wy3z0ydrt32f57ddhuk0mngpk0r";
  const amount = ethers.parseEther("0.001");
  const secret = "sepolia_secret_" + Date.now();
  const secretBytes = ethers.toUtf8Bytes(secret);
  const secretHash = ethers.keccak256(secretBytes);
  const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  
  console.log("Order parameters:");
  console.log(`- Resolver contract: ${RESOLVER_ADDRESS}`);
  console.log(`- Cosmos recipient: ${cosmosRecipient}`);
  console.log(`- Amount: ${ethers.formatEther(amount)} ETH`);
  console.log(`- Secret: ${secret}`);
  console.log(`- Secret Hash: ${secretHash}`);
  console.log(`- Timelock: ${new Date(timelock * 1000).toISOString()}\n`);
  
  console.log("Creating order...");
  const createTx = await resolver.createOrder(
    CHAIN_ID_COSMOS_NEUTRON,
    cosmosRecipient,
    ethers.ZeroAddress, // ETH
    amount,
    secretHash,
    timelock,
    { value: amount }
  );
  
  const receipt = await createTx.wait();
  console.log(`Transaction hash: ${receipt.hash}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  
  // Extract order ID from events
  const event = receipt.logs.find((log: any) => {
    try {
      const parsed = resolver.interface.parseLog(log);
      return parsed?.name === "OrderCreated";
    } catch {
      return false;
    }
  });
  
  if (event) {
    const parsed = resolver.interface.parseLog(event);
    const orderId = parsed?.args[0];
    console.log(`\n✅ Order created! Order ID: ${orderId}`);
    
    // Query the order
    const order = await resolver.getOrder(orderId);
    console.log("\nOrder details:");
    console.log(`- Initiator: ${order.initiator}`);
    console.log(`- Dst Chain: ${order.dstChainId}`);
    console.log(`- Dst Recipient: ${order.dstRecipient}`);
    console.log(`- Amount: ${ethers.formatEther(order.amount)} ETH`);
    console.log(`- Src Deployed: ${order.srcDeployed}`);
    console.log(`- Dst Deployed: ${order.dstDeployed}`);
    
    // Save test data
    const testData = {
      sepolia: {
        orderId: orderId.toString(),
        secret,
        secretHash,
        initiator: wallet.address,
        amount: amount.toString(),
        txHash: receipt.hash,
        resolver: RESOLVER_ADDRESS
      },
      cosmos: {
        recipient: cosmosRecipient,
        chainId: CHAIN_ID_COSMOS_NEUTRON
      },
      timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(
      'test-sepolia-to-cosmos.json',
      JSON.stringify(testData, null, 2)
    );
    
    console.log("\n=== Next Steps ===");
    console.log("1. Resolver sees this OrderCreated event");
    console.log("2. Resolver fills the order by depositing safety deposit");
    console.log("3. Resolver creates matching order on Cosmos");
    console.log("4. User reveals secret on Cosmos to claim NTRN");
    console.log("5. Resolver uses revealed secret to withdraw ETH + safety deposit");
    console.log(`\nSecret to reveal on Cosmos: ${secret}`);
    
    return { orderId, secret, secretHash };
  }
}

async function simulateResolverFillOrder(orderId: number) {
  console.log("\n=== Simulating Resolver Filling Order ===\n");
  
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const resolver = new ethers.Contract(RESOLVER_ADDRESS, COSMOS_RESOLVER_ABI, wallet);
  
  const safetyDeposit = ethers.parseEther("0.0005");
  
  console.log(`Filling order ${orderId} with safety deposit: ${ethers.formatEther(safetyDeposit)} ETH`);
  
  const fillTx = await resolver.fillOrder(
    orderId,
    safetyDeposit,
    { value: safetyDeposit }
  );
  
  await fillTx.wait();
  console.log(`Fill transaction: ${fillTx.hash}`);
  
  // Check updated order
  const order = await resolver.getOrder(orderId);
  console.log(`\nOrder resolver: ${order.resolver}`);
  console.log(`Safety deposit: ${ethers.formatEther(order.safetyDeposit)} ETH`);
  
  return order;
}

// Main function
async function main() {
  try {
    // Create a new Sepolia to Cosmos order
    const result = await createSepoliaToCosmosOrder();
    if (!result) {
      throw new Error("Failed to create order");
    }
    const { orderId, secret, secretHash } = result;
    
    // Simulate resolver filling the order
    await simulateResolverFillOrder(orderId);
    
    console.log("\n🎉 Sepolia → Cosmos order created and filled!");
    console.log("\nFull E2E test data saved to:");
    console.log("- test-sepolia-to-cosmos.json");
    console.log("- sepolia-deployment.json");
    
    // Summary
    console.log("\n=== Summary ===");
    console.log("✅ CosmosResolver deployed on Sepolia");
    console.log("✅ Sepolia → Cosmos order created");
    console.log("✅ Resolver filled order with safety deposit");
    console.log("🔄 Ready for Cosmos side integration");
    
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}