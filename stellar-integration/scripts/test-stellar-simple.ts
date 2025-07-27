import * as StellarSdk from '@stellar/stellar-sdk';

const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');

async function testAccount() {
    try {
        // Generate a new keypair for testing
        const pair = StellarSdk.Keypair.random();
        console.log('Secret:', pair.secret());
        console.log('Public Key:', pair.publicKey());
        
        // Fund the account using friendbot
        console.log('\nFunding account...');
        const response = await fetch(
            `https://friendbot.stellar.org?addr=${encodeURIComponent(pair.publicKey())}`
        );
        const responseJSON = await response.json();
        console.log('Friendbot response:', responseJSON);
        
        // Check account balance
        const account = await server.loadAccount(pair.publicKey());
        console.log('\nBalances:');
        account.balances.forEach((balance: any) => {
            console.log('Type:', balance.asset_type, 'Balance:', balance.balance);
        });
        
    } catch (error) {
        console.error('Error:', error);
    }
}

testAccount();