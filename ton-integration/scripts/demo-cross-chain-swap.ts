import { Address, toNano } from '@ton/core';
import { FusionHTLC } from '../wrappers/FusionHTLC';
import { generateSecret, calculateTimelock } from '../src/utils';
import * as fs from 'fs';
import * as path from 'path';

async function demoCrossChainSwap() {
    console.log('🔄 Fusion Plus - TON Cross-Chain Swap Demo\n');
    
    // Load deployment info
    const deploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));
    
    console.log('📋 Contract Info:');
    console.log('Network:', deployment.network);
    console.log('HTLC Address:', deployment.contractAddress);
    console.log('Wallet:', deployment.walletAddress);
    console.log('\n' + '='.repeat(60) + '\n');
    
    // 1. Generate swap parameters
    console.log('1️⃣ Generating swap parameters...');
    const { secret, hashlock } = await FusionHTLC.generateSecret();
    const timelock = FusionHTLC.calculateTimelock(3600); // 1 hour
    
    console.log('Secret:', secret.toString('hex'));
    console.log('Hashlock:', hashlock.toString('hex'));
    console.log('Timelock:', new Date(timelock * 1000).toLocaleString());
    console.log('\n' + '='.repeat(60) + '\n');
    
    // 2. Simulate EVM to TON swap flow
    console.log('2️⃣ EVM → TON Swap Flow:\n');
    
    console.log('Step 1: User creates HTLC on EVM (Ethereum/Polygon/etc)');
    console.log('- Amount: 100 USDC');
    console.log('- Receiver: TON address', deployment.walletAddress);
    console.log('- Hashlock:', hashlock.toString('hex').slice(0, 16) + '...');
    console.log('- Timelock: 1 hour\n');
    
    console.log('Step 2: Resolver detects EVM HTLC and creates matching HTLC on TON');
    console.log('- Contract:', deployment.contractAddress);
    console.log('- Amount: 95 USDT (after fees)');
    console.log('- Same hashlock and shorter timelock (45 minutes)\n');
    
    console.log('Step 3: User claims TON HTLC with secret');
    console.log('- HTLC ID: 0');
    console.log('- Secret revealed:', secret.toString('hex').slice(0, 16) + '...\n');
    
    console.log('Step 4: Resolver uses revealed secret to claim EVM HTLC');
    console.log('- Swap completed! ✅\n');
    
    console.log('='.repeat(60) + '\n');
    
    // 3. Simulate TON to EVM swap flow
    console.log('3️⃣ TON → EVM Swap Flow:\n');
    
    console.log('Step 1: User creates HTLC on TON');
    console.log('- Contract:', deployment.contractAddress);
    console.log('- Amount: 1 TON');
    console.log('- Receiver: Resolver TON address');
    console.log('- New hashlock for this swap\n');
    
    console.log('Step 2: Resolver creates matching HTLC on EVM');
    console.log('- Amount: 2.5 USDC (at current rates)');
    console.log('- Receiver: User\'s EVM address');
    console.log('- Same hashlock, shorter timelock\n');
    
    console.log('Step 3: User claims EVM HTLC');
    console.log('- Secret revealed on EVM chain\n');
    
    console.log('Step 4: Resolver claims TON HTLC');
    console.log('- Swap completed! ✅\n');
    
    console.log('='.repeat(60) + '\n');
    
    // 4. Contract interaction examples
    console.log('4️⃣ Contract Interaction Examples:\n');
    
    console.log('Create HTLC (TypeScript):');
    console.log(`
const htlcId = await tonClient.createHTLC({
    receiver: "EQC...",
    amount: toNano('1'),
    hashlock: Buffer.from('...'),
    timelock: Math.floor(Date.now() / 1000) + 3600
});
`);
    
    console.log('Claim HTLC:');
    console.log(`
await tonClient.claimHTLC(htlcId, secret);
`);
    
    console.log('Check HTLC status:');
    console.log(`
const htlc = await tonClient.getHTLC(htlcId);
console.log('Status:', htlc.claimed ? 'Claimed' : 'Active');
`);
    
    console.log('\n' + '='.repeat(60) + '\n');
    
    // 5. Security considerations
    console.log('5️⃣ Security Considerations:\n');
    console.log('✓ Always use shorter timelock on target chain');
    console.log('✓ Verify amounts and fees before creating HTLCs');
    console.log('✓ Monitor both chains for transaction finality');
    console.log('✓ Keep secrets secure until claiming');
    console.log('✓ Have refund mechanisms in place\n');
    
    console.log('='.repeat(60));
    console.log('\n🎉 Demo completed! Ready for cross-chain swaps.\n');
    console.log('Next steps:');
    console.log('1. Deploy contract to TON testnet (when rate limits reset)');
    console.log('2. Deploy matching HTLC contract on EVM testnet');
    console.log('3. Run actual cross-chain swap tests');
    console.log('4. Integrate with 1inch Fusion UI\n');
}

demoCrossChainSwap().catch(console.error);