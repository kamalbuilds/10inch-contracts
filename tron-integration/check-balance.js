const TronWeb = require('tronweb');

const tronWeb = new TronWeb({
    fullHost: 'https://api.shasta.trongrid.io',
    privateKey: 'b50a5403ccfbb9e9e569522268bd249bc39541531e99eb1ba52685524f41eb8e'
});

async function checkBalance() {
    const address = 'TKJc3zkw2k39uQn3meqNmYrxPFdx73pSav';
    console.log('Checking balance for:', address);
    
    try {
        const balance = await tronWeb.trx.getBalance(address);
        console.log('Balance:', balance / 1e6, 'TRX');
        
        const account = await tronWeb.trx.getAccount(address);
        console.log('Account exists:', Object.keys(account).length > 0);
        
        console.log('\nTo get test TRX, visit: https://www.trongrid.io/shasta');
        console.log('Use address:', address);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkBalance();