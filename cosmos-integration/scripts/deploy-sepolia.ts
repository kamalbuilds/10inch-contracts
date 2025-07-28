import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
config();

// Sepolia configuration
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "https://sepolia.infura.io/v3/YOUR_PROJECT_ID";
const CHAIN_ID_COSMOS_NEUTRON = 1; // As defined in the contract

// Compile the contract (simple version)
const COSMOS_RESOLVER_ABI = [
  "constructor()",
  "function createOrder(uint32 dstChainId, string calldata dstRecipient, address token, uint256 amount, bytes32 secretHash, uint256 timelock) external payable returns (uint256)",
  "function fillOrder(uint256 orderId, uint256 safetyDeposit) external payable",
  "function deployDstEscrow(uint256 orderId, string calldata cosmosOrderId, tuple(string orderHash, uint32 srcChainId, uint32 dstChainId, string srcToken, string dstToken, string srcAmount, string dstAmount, address resolver, string beneficiary, bytes32 secretHash, uint256 finalityTimestamp, uint256 resolverTimestamp, uint256 beneficiaryTimestamp, uint256 safetyDeposit) calldata immutables) external",
  "function withdraw(uint256 orderId, bytes32 secret) external",
  "function cancel(uint256 orderId) external",
  "function getOrder(uint256 orderId) external view returns (tuple(uint256 orderId, address initiator, address resolver, uint32 srcChainId, uint32 dstChainId, address token, uint256 amount, string dstRecipient, bytes32 secretHash, uint256 timelock, uint256 safetyDeposit, bool srcDeployed, bool dstDeployed, bool completed, bool cancelled))",
  "function canWithdraw(uint256 orderId, address user) external view returns (bool)",
  "function canCancel(uint256 orderId) external view returns (bool)",
  "function verifySecret(bytes32 secret, bytes32 secretHash) external pure returns (bool)",
  "event OrderCreated(uint256 indexed orderId, address indexed initiator, address indexed resolver, uint32 dstChainId, string dstRecipient, bytes32 secretHash, uint256 amount, uint256 timelock)",
  "event DstEscrowDeployed(uint256 indexed orderId, address indexed resolver, string cosmosOrderId, uint256 amount, bytes32 secretHash)",
  "event Withdrawn(uint256 indexed orderId, address indexed user, uint256 amount, bytes32 secret)",
  "event Cancelled(uint256 indexed orderId, address indexed user, uint256 amount)"
];

// Simple bytecode for deployment (you'll need the actual bytecode)
const COSMOS_RESOLVER_BYTECODE = "0x608060405234801561001057600080fd5b50336000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550612d7d806100606000396000f3fe"; // Placeholder

async function deploySepolia() {
  console.log("=== Deploying Cosmos Resolver to Sepolia ===\n");
  
  // Check environment
  if (!process.env.SEPOLIA_PRIVATE_KEY) {
    console.error("Please set SEPOLIA_PRIVATE_KEY in .env file");
    return;
  }
  
  // Connect to Sepolia
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY, provider);
  
  console.log(`Deployer address: ${wallet.address}`);
  
  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  
  if (balance < ethers.parseEther("0.01")) {
    console.error("Insufficient balance. Need at least 0.01 ETH for deployment.");
    console.log("Get Sepolia ETH from: https://sepoliafaucet.com/");
    return;
  }
  
  // For now, we'll use a pre-deployed contract address if available
  // In production, you'd compile and deploy the actual contract
  console.log("\n=== Using EscrowFactory Pattern ===");
  console.log("For production deployment, you would:");
  console.log("1. Compile CosmosResolver.sol");
  console.log("2. Deploy using the compiled bytecode");
  console.log("3. Or use the existing EscrowFactory from cross-chain-swap");
  
  // Save deployment info
  const deploymentInfo = {
    network: "sepolia",
    chainId: 11155111,
    rpc: SEPOLIA_RPC,
    deployer: wallet.address,
    cosmosContracts: {
      atomicSwap: "neutron1tnetwd64jle2xncgkcpuf38sp9xhud7sku6tezjvvwdhvsfv6j3qeqkd53",
      bridge: "neutron1fw9wc9uyf0maluja7ftu25amx9w3yx6lqknvec5gejvz0974nrfq3zqcwz",
      resolver: "neutron1haev26g5d2es97kr8lup59aykf9raeu59w8nhtzr2t4fju0702qstcr42v"
    },
    evmContracts: {
      // You can use the existing EscrowFactory from the cross-chain-swap repo
      escrowFactory: "0x...", // Deploy or use existing
      cosmosResolver: "0x...", // Deploy CosmosResolver.sol
    },
    timestamp: new Date().toISOString()
  };
  
  console.log("\n=== Next Steps ===");
  console.log("1. Compile CosmosResolver.sol with Hardhat or Foundry");
  console.log("2. Deploy to Sepolia");
  console.log("3. Or use existing EscrowFactory contracts");
  console.log("\nExample using Foundry:");
  console.log("forge create --rpc-url $SEPOLIA_RPC --private-key $SEPOLIA_PRIVATE_KEY contracts/CosmosResolver.sol:CosmosResolver");
  
  fs.writeFileSync(
    path.join(__dirname, "..", "deployment-sepolia.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\nDeployment info template saved to deployment-sepolia.json");
}

// Test function for Sepolia to Cosmos
export async function testSepoliaToCosmosOrder() {
  console.log("=== Testing Sepolia to Cosmos Order ===\n");
  
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(process.env.SEPOLIA_PRIVATE_KEY!, provider);
  
  // Use a deployed CosmosResolver contract
  const resolverAddress = process.env.COSMOS_RESOLVER_ADDRESS;
  if (!resolverAddress) {
    console.error("Please set COSMOS_RESOLVER_ADDRESS in .env");
    return;
  }
  
  const resolver = new ethers.Contract(resolverAddress, COSMOS_RESOLVER_ABI, wallet);
  
  // Test parameters
  const cosmosRecipient = "neutron1njzwck6re79wy3z0ydrt32f57ddhuk0mngpk0r"; // Your Cosmos address
  const amount = ethers.parseEther("0.001"); // 0.001 ETH
  const secret = "mysecret" + Date.now();
  const secretHash = ethers.keccak256(ethers.toUtf8Bytes(secret));
  const timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  
  console.log(`Secret: ${secret}`);
  console.log(`Secret Hash: ${secretHash}`);
  
  try {
    // Create order
    console.log("\nCreating order...");
    const tx = await resolver.createOrder(
      CHAIN_ID_COSMOS_NEUTRON,
      cosmosRecipient,
      ethers.ZeroAddress, // ETH (not token)
      amount,
      secretHash,
      timelock,
      { value: amount }
    );
    
    const receipt = await tx.wait();
    console.log(`Transaction hash: ${receipt.hash}`);
    
    // Extract order ID from events
    const event = receipt.logs.find(log => {
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
      console.log(`Order ID: ${orderId}`);
      
      // Query order details
      const order = await resolver.getOrder(orderId);
      console.log("\nOrder details:", order);
      
      console.log("\n=== Next Steps ===");
      console.log("1. Resolver fills this order by calling fillOrder()");
      console.log("2. Resolver deploys escrow on Cosmos");
      console.log("3. User reveals secret on Cosmos to claim NTRN");
      console.log("4. Resolver uses secret to claim ETH on Sepolia");
      
      // Save test data
      const testData = {
        sepolia: {
          orderId: orderId.toString(),
          secret,
          secretHash,
          initiator: wallet.address,
          amount: amount.toString(),
          txHash: receipt.hash
        },
        cosmos: {
          recipient: cosmosRecipient,
          chainId: CHAIN_ID_COSMOS_NEUTRON
        },
        timestamp: new Date().toISOString()
      };
      
      fs.writeFileSync(
        "test-sepolia-to-cosmos.json",
        JSON.stringify(testData, null, 2)
      );
      console.log("\nTest data saved to test-sepolia-to-cosmos.json");
    }
    
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run deployment
if (require.main === module) {
  deploySepolia().catch(console.error);
}