import { ethers } from 'ethers';
import { TonFusionClient } from '../src/ton-fusion-client';
import { generateSecret, calculateTimelock } from '../src/utils';
import * as fs from 'fs';
import * as path from 'path';

// Load shared HTLC deployment
const sharedDeployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../shared-htlc-deployment.json'), 'utf-8')
);

async function testEVMToTONSwap() {
    console.log('🔄 Testing EVM to TON Cross-Chain Swap\n');
    
    try {
        // Load deployment info
        const deploymentPath = path.join(__dirname, '..', 'deployment-testnet.json');
        let tonHTLCAddress: string;
        
        if (fs.existsSync(deploymentPath)) {
            const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));
            tonHTLCAddress = deployment.address;
        } else {
            console.error('❌ No deployment found. Please run deploy-testnet.ts first');
            return;
        }
        
        // Configuration
        const config = {
            // TON Configuration
            tonRpcUrl: 'https://ton-testnet.core.chainstack.com/b8bbd452320f925e94af21120bac55b0/api/v2/jsonRPC',
            tonHTLCAddress,
            tonMnemonic: process.env.TON_MNEMONIC || 'your mnemonic here',
            
            // EVM Configuration (Sepolia)
            evmRpcUrl: process.env.EVM_RPC_URL || 'https://1rpc.io/sepolia',
            evmHTLCAddress: sharedDeployment.sepolia.contractAddress, // Using shared deployment
            evmPrivateKey: process.env.EVM_PRIVATE_KEY || '',
            evmHTLCABI: sharedDeployment.sepolia.abi,
        };
        
        // Initialize clients
        console.log('📱 Initializing clients...');
        
        // TON Client
        const tonClient = new TonFusionClient(config.tonRpcUrl, config.tonHTLCAddress);
        await tonClient.init(config.tonMnemonic.split(' '));
        
        // EVM Client
        const evmProvider = new ethers.JsonRpcProvider(config.evmRpcUrl);
        const evmWallet = new ethers.Wallet(config.evmPrivateKey, evmProvider);
        const evmHTLC = new ethers.Contract(config.evmHTLCAddress, config.evmHTLCABI, evmWallet);
        
        console.log('TON Wallet:', tonClient.getWalletAddress());
        console.log('EVM Wallet:', evmWallet.address);
        
        // Generate swap parameters
        const { secret, hashlock } = await generateSecret();
        const swapAmount = ethers.parseEther('0.01'); // 0.01 ETH
        const timelock = calculateTimelock(3600); // 1 hour
        
        console.log('\n🔐 Swap Parameters:');
        console.log('Amount:', ethers.formatEther(swapAmount), 'ETH');
        console.log('Hashlock:', hashlock.toString('hex'));
        console.log('Timelock:', new Date(timelock * 1000).toLocaleString());
        
        // Step 1: Create HTLC on EVM (source chain)
        console.log('\n1️⃣ Creating HTLC on EVM (Sepolia)...');
        console.log('Using shared HTLC at:', config.evmHTLCAddress);
        const createTx = await evmHTLC.createHTLC(
            tonClient.getWalletAddress(), // Receiver on TON
            '0x' + hashlock.toString('hex'),
            timelock,
            { value: swapAmount }
        );
        
        const receipt = await createTx.wait();
        console.log('✅ EVM HTLC created. Tx:', receipt.hash);
        
        // Extract HTLC ID from events
        const htlcCreatedEvent = receipt.logs.find(log => 
            log.topics[0] === ethers.id('HTLCCreated(bytes32,address,address,uint256,bytes32,uint256)')
        );
        const htlcId = htlcCreatedEvent?.topics[1] || receipt.logs[0].topics[1];
        console.log('HTLC ID:', htlcId);
        
        // Step 2: Wait for resolver to create corresponding HTLC on TON
        console.log('\n2️⃣ Waiting for resolver to create TON HTLC...');
        console.log('⏳ In a real scenario, the resolver would detect the EVM HTLC and create a matching one on TON');
        
        // For demo purposes, we'll create it manually
        const tonHTLCId = await tonClient.createHTLC({
            receiver: evmWallet.address, // Simplified address conversion
            amount: BigInt(swapAmount.toString()),
            hashlock,
            timelock: timelock - 1800, // 30 minutes less for safety
        });
        
        console.log('✅ TON HTLC created. ID:', tonHTLCId);
        
        // Step 3: Reveal secret and claim on TON
        console.log('\n3️⃣ Claiming TON HTLC with secret...');
        await tonClient.claimHTLC(tonHTLCId, secret);
        console.log('✅ TON HTLC claimed successfully!');
        
        // Step 4: Resolver claims on EVM using the revealed secret
        console.log('\n4️⃣ Resolver claiming EVM HTLC...');
        const claimTx = await evmHTLC.withdraw(htlcId, '0x' + secret.toString('hex'));
        await claimTx.wait();
        console.log('✅ EVM HTLC claimed successfully!');
        
        // Verify final state
        console.log('\n📊 Final State:');
        const tonHTLC = await tonClient.getHTLC(tonHTLCId);
        const evmHTLCData = await evmHTLC.getContract(htlcId);
        
        console.log('TON HTLC:', {
            claimed: tonHTLC?.claimed,
            secret: tonHTLC?.secret?.toString('hex'),
        });
        
        console.log('EVM HTLC:', {
            withdrawn: evmHTLCData.withdrawn,
            preimage: evmHTLCData.preimage,
        });
        
        console.log('\n🎉 Cross-chain swap completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run test
testEVMToTONSwap().catch(console.error);