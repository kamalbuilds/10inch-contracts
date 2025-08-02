import * as StellarSdk from "@stellar/stellar-sdk";
import * as fs from "fs";
import * as path from "path";

const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const SERVER_URL = "https://soroban-testnet.stellar.org";

// Initialize server
const server = new StellarSdk.SorobanRpc.Server(SERVER_URL);

// Contract WASM path
const FUSION_HTLC_WASM = path.join(__dirname, "../contracts/fusion-htlc/target/wasm32-unknown-unknown/release/fusion_htlc.wasm");

async function deployFusionHTLC() {
    try {
        console.log("🚀 Deploying Fusion HTLC with multi-stage settlement...");
        
        // Load deployer account
        const deployerSecret = process.env.STELLAR_SECRET_KEY;
        if (!deployerSecret) {
            throw new Error("Please set STELLAR_SECRET_KEY environment variable");
        }
        
        const deployerKeypair = StellarSdk.Keypair.fromSecret(deployerSecret);
        const deployerAccount = await server.getAccount(deployerKeypair.publicKey());
        
        console.log("Deployer address:", deployerKeypair.publicKey());
        
        // Check if contract WASM exists
        if (!fs.existsSync(FUSION_HTLC_WASM)) {
            console.error("Contract WASM not found. Please build the contract first:");
            console.error("cd contracts/fusion-htlc && cargo build --release --target wasm32-unknown-unknown");
            process.exit(1);
        }
        
        // Read contract WASM
        const contractWasm = fs.readFileSync(FUSION_HTLC_WASM);
        
        // Create contract
        console.log("Creating contract...");
        const createContract = new StellarSdk.Contract("");
        const uploadTransaction = new StellarSdk.TransactionBuilder(deployerAccount, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(
                StellarSdk.Operation.uploadContractWasm({
                    wasm: contractWasm,
                })
            )
            .setTimeout(30)
            .build();
        
        // Prepare and submit upload transaction
        const preparedUpload = await server.prepareTransaction(uploadTransaction);
        preparedUpload.sign(deployerKeypair);
        
        console.log("Uploading contract WASM...");
        const uploadResult = await server.sendTransaction(preparedUpload);
        
        // Wait for confirmation
        let uploadResponse = await server.getTransaction(uploadResult.hash);
        while (uploadResponse.status === "PENDING" || uploadResponse.status === "NOT_FOUND") {
            await new Promise(resolve => setTimeout(resolve, 1000));
            uploadResponse = await server.getTransaction(uploadResult.hash);
        }
        
        if (uploadResponse.status !== "SUCCESS") {
            throw new Error(`Upload failed: ${JSON.stringify(uploadResponse)}`);
        }
        
        // Get WASM hash from the result
        const wasmHash = uploadResponse.returnValue;
        console.log("WASM Hash:", wasmHash);
        
        // Create contract from WASM
        const createTx = new StellarSdk.TransactionBuilder(deployerAccount, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(
                StellarSdk.Operation.createContract({
                    wasmHash: wasmHash,
                    address: StellarSdk.Address.fromString(deployerKeypair.publicKey()),
                    salt: StellarSdk.xdr.HashId.sha256(Buffer.from("fusion-htlc")),
                })
            )
            .setTimeout(30)
            .build();
        
        const preparedCreate = await server.prepareTransaction(createTx);
        preparedCreate.sign(deployerKeypair);
        
        console.log("Creating contract instance...");
        const createResult = await server.sendTransaction(preparedCreate);
        
        // Wait for confirmation
        let createResponse = await server.getTransaction(createResult.hash);
        while (createResponse.status === "PENDING" || createResponse.status === "NOT_FOUND") {
            await new Promise(resolve => setTimeout(resolve, 1000));
            createResponse = await server.getTransaction(createResult.hash);
        }
        
        if (createResponse.status !== "SUCCESS") {
            throw new Error(`Create contract failed: ${JSON.stringify(createResponse)}`);
        }
        
        // Get contract address
        const contractAddress = createResponse.returnValue;
        console.log("Contract deployed at:", contractAddress);
        
        // Initialize the contract
        console.log("Initializing contract...");
        const contract = new StellarSdk.Contract(contractAddress);
        
        // Initialize with default parameters
        const initTx = new StellarSdk.TransactionBuilder(deployerAccount, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: NETWORK_PASSPHRASE,
        })
            .addOperation(
                contract.call(
                    "initialize",
                    StellarSdk.Address.fromString(deployerKeypair.publicKey()), // admin
                    StellarSdk.xdr.ScVal.scvU32(250), // default_resolver_fee_bps (2.5%)
                    StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString("300")), // min_timelock (5 minutes)
                    StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString("604800")) // max_timelock (7 days)
                )
            )
            .setTimeout(30)
            .build();
        
        const preparedInit = await server.prepareTransaction(initTx);
        preparedInit.sign(deployerKeypair);
        
        const initResult = await server.sendTransaction(preparedInit);
        
        // Wait for confirmation
        let initResponse = await server.getTransaction(initResult.hash);
        while (initResponse.status === "PENDING" || initResponse.status === "NOT_FOUND") {
            await new Promise(resolve => setTimeout(resolve, 1000));
            initResponse = await server.getTransaction(initResult.hash);
        }
        
        if (initResponse.status !== "SUCCESS") {
            throw new Error(`Initialize failed: ${JSON.stringify(initResponse)}`);
        }
        
        console.log("✅ Contract initialized successfully!");
        
        // Save deployment info
        const deploymentInfo = {
            network: "testnet",
            contractAddress: contractAddress,
            wasmHash: wasmHash,
            deployerAddress: deployerKeypair.publicKey(),
            deploymentTime: new Date().toISOString(),
            configuration: {
                defaultResolverFeeBps: 250,
                minTimelock: 300,
                maxTimelock: 604800
            },
            features: {
                multiStageSettlement: true,
                stages: [
                    "Pending (before finality)",
                    "Taker Settlement (exclusive period for original taker)",
                    "Private Settlement (whitelisted resolvers)",
                    "Public Settlement (anyone can settle)",
                    "Private Cancellation (sender/whitelisted can cancel)",
                    "Public Cancellation (anyone can cancel)"
                ]
            }
        };
        
        fs.writeFileSync(
            path.join(__dirname, "../fusion-htlc-deployment.json"),
            JSON.stringify(deploymentInfo, null, 2)
        );
        
        console.log("\n📄 Deployment info saved to fusion-htlc-deployment.json");
        console.log("\n🎯 Fusion HTLC Features:");
        console.log("- Multi-stage settlement with 6 distinct phases");
        console.log("- Taker exclusive period for original order taker");
        console.log("- Private resolver period for whitelisted resolvers");
        console.log("- Public settlement period for any resolver");
        console.log("- Two-stage cancellation (private then public)");
        console.log("- Configurable resolver fees and stage durations");
        console.log("- Global resolver registry with priority system");
        
    } catch (error) {
        console.error("Deployment failed:", error);
        process.exit(1);
    }
}

// Run deployment
deployFusionHTLC();