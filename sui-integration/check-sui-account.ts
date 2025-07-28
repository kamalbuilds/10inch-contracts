import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { fromHEX, fromB64 } from '@mysten/sui.js/utils';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import * as dotenv from 'dotenv';

dotenv.config();

async function checkAndFundSuiAccount() {
    console.log('🔍 Checking Sui Account...\n');

    // Initialize Sui client
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });

    // Create keypair from private key - handle both formats
    let keypair: Ed25519Keypair;
    const privateKey = process.env.SUI_PRIVATE_KEY!;
    
    if (privateKey.startsWith('suiprivkey')) {
        // New format: decode the bech32 encoded key
        const decoded = decodeSuiPrivateKey(privateKey);
        keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
    } else {
        // Old format: hex encoded
        const privateKeyBytes = fromHEX(privateKey);
        keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
    }
    
    const address = keypair.getPublicKey().toSuiAddress();
    console.log('📍 Account Address:', address);
    console.log('🔑 Public Key:', keypair.getPublicKey().toBase64());

    try {
        // Check balance
        const balance = await client.getBalance({
            owner: address,
        });
        
        const suiBalance = parseInt(balance.totalBalance) / 1e9;
        console.log('💰 Balance:', suiBalance, 'SUI');

        if (suiBalance === 0) {
            console.log('\n⚠️  Account needs funding! Requesting from faucet...');
            
            // Try to request from faucet
            try {
                const response = await fetch('https://faucet.testnet.sui.io/v2/gas', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        FixedAmountRequest: {
                            recipient: address
                        }
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    console.log('✅ Faucet request successful!');
                    console.log('Transaction:', result);
                    
                    // Wait a bit for transaction to process
                    console.log('\nWaiting for transaction to process...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // Check balance again
                    const newBalance = await client.getBalance({
                        owner: address,
                    });
                    const newSuiBalance = parseInt(newBalance.totalBalance) / 1e9;
                    console.log('💰 New Balance:', newSuiBalance, 'SUI');
                } else {
                    const error = await response.text();
                    console.log('❌ Faucet request failed:', error);
                    console.log('\nAlternative: Use Discord faucet');
                    console.log('1. Join: https://discord.gg/sui');
                    console.log('2. Go to #testnet-faucet channel');
                    console.log('3. Type: !faucet', address);
                }
            } catch (error) {
                console.error('Error requesting from faucet:', error);
                console.log('\nPlease use Discord faucet instead:');
                console.log('1. Join: https://discord.gg/sui');
                console.log('2. Go to #testnet-faucet channel');
                console.log('3. Type: !faucet', address);
            }
        }

        // Get recent transactions
        console.log('\n📜 Recent Activity:');
        const txs = await client.queryTransactionBlocks({
            filter: {
                FromAddress: address,
            },
            limit: 5,
        });

        if (txs.data.length > 0) {
            console.log(`Found ${txs.data.length} recent transactions`);
        } else {
            console.log('No recent transactions');
        }

    } catch (error) {
        console.error('Error:', error);
    }

    console.log('\n🔗 View on Explorer:');
    console.log(`https://suiexplorer.com/address/${address}?network=testnet`);
}

checkAndFundSuiAccount().catch(console.error);