#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const NETWORK = process.env.NEAR_NETWORK || 'testnet';
const ACCOUNT_ID = process.env.NEAR_ACCOUNT_ID || 'fusion-htlc-demo.testnet';
const MASTER_ACCOUNT = process.env.NEAR_MASTER_ACCOUNT || 'your-master-account.testnet';

console.log('🚀 Deploying NEAR Fusion+ Contract');
console.log(`Network: ${NETWORK}`);
console.log(`Contract Account: ${ACCOUNT_ID}`);
console.log(`Master Account: ${MASTER_ACCOUNT}\n`);

// Step 1: Build the contract
console.log('📦 Building contract...');
try {
  execSync('cargo near build non-reproducible-wasm', { stdio: 'inherit' });
  console.log('✅ Contract built successfully\n');
} catch (error) {
  console.error('❌ Failed to build contract:', error);
  process.exit(1);
}

// Step 2: Create account if it doesn't exist
console.log('👤 Creating contract account...');
try {
  execSync(
    `near create-account ${ACCOUNT_ID} --masterAccount ${MASTER_ACCOUNT} --initialBalance 10`,
    { stdio: 'inherit' }
  );
  console.log('✅ Account created successfully\n');
} catch (error) {
  console.log('ℹ️  Account might already exist, continuing...\n');
}

// Step 3: Deploy the contract
console.log('🚢 Deploying contract...');
const wasmPath = path.join(__dirname, '../target/near/fusion_htlc_near.wasm');

if (!fs.existsSync(wasmPath)) {
  console.error('❌ WASM file not found at:', wasmPath);
  process.exit(1);
}

try {
  execSync(
    `near deploy ${ACCOUNT_ID} ${wasmPath}`,
    { stdio: 'inherit' }
  );
  console.log('✅ Contract deployed successfully\n');
} catch (error) {
  console.error('❌ Failed to deploy contract:', error);
  process.exit(1);
}

// Step 4: Initialize the contract
console.log('🔧 Initializing contract...');
try {
  execSync(
    `near call ${ACCOUNT_ID} new '{}' --account-id ${ACCOUNT_ID}`,
    { stdio: 'inherit' }
  );
  console.log('✅ Contract initialized successfully\n');
} catch (error) {
  console.error('❌ Failed to initialize contract:', error);
  process.exit(1);
}

// Step 5: Verify deployment
console.log('🔍 Verifying deployment...');
try {
  execSync(
    `near view ${ACCOUNT_ID} get_stats`,
    { stdio: 'inherit' }
  );
  console.log('✅ Contract is responding correctly\n');
} catch (error) {
  console.error('❌ Failed to verify contract:', error);
  process.exit(1);
}

console.log('🎉 Deployment completed successfully!');
console.log(`Contract deployed at: ${ACCOUNT_ID}`);
console.log(`Network: ${NETWORK}`);

// Save deployment info
const deploymentInfo = {
  contractId: ACCOUNT_ID,
  network: NETWORK,
  deployedAt: new Date().toISOString(),
  wasmHash: execSync(`sha256sum ${wasmPath}`).toString().split(' ')[0],
};

fs.writeFileSync(
  path.join(__dirname, '../deployment.json'),
  JSON.stringify(deploymentInfo, null, 2)
);

console.log('\nDeployment info saved to deployment.json');