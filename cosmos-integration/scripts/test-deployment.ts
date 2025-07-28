import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import { config } from 'dotenv';
config();

// Neutron testnet configuration
const NEUTRON_RPC = "https://rpc-falcron.pion-1.ntrn.tech";
const NEUTRON_CHAIN_ID = "pion-1";

async function testConnection() {
console.log("cosmos mnemonic", process.env.COSMOS_MNEMONIC);
  
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
  console.log(`Balance: ${balance.amount} untrn (${parseInt(balance.amount) / 1000000} NTRN)`);
  
  // Check chain info
  const height = await client.getHeight();
  console.log(`Current block height: ${height}`);
  
  const chainId = await client.getChainId();
  console.log(`Chain ID: ${chainId}`);
  
  // Check if there are any existing code IDs we can use
  console.log("\nChecking existing contracts...");
  try {
    // Try to query codes (this might fail if not supported)
    const codes = await client.getCodes();
    console.log(`Found ${codes.length} uploaded codes`);
    if (codes.length > 0) {
      console.log("First few codes:", codes.slice(0, 3));
    }
  } catch (e) {
    console.log("Could not query codes");
  }
}

testConnection().catch(console.error);