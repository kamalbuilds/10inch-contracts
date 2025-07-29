const TronWeb = require('tronweb');
require('dotenv').config();

const tronWeb = new TronWeb({
    fullHost: 'https://api.shasta.trongrid.io',
    privateKey: process.env.PRIVATE_KEY_SHASTA.replace(/['"]/g, '')
});

const ATOMIC_SWAP_ADDRESS = 'TATH2MqmeKRDmDN4E5rjZkbnHLyc5LzWo7';
const MOCK_TOKEN_ADDRESS = 'TS6x88KenYTygTZYPSsninTqihBJRVBZTn';

async function testDeployment() {
    console.log('Testing Tron Fusion+ Integration Deployment...\n');
    
    try {
        // Get contract instances
        const atomicSwap = await tronWeb.contract().at(ATOMIC_SWAP_ADDRESS);
        const mockToken = await tronWeb.contract().at(MOCK_TOKEN_ADDRESS);
        
        // Check admin
        const admin = await atomicSwap.admin().call();
        console.log('Admin:', tronWeb.address.fromHex(admin));
        
        // Check protocol fee rate
        const feeRate = await atomicSwap.protocolFeeRate().call();
        console.log('Protocol Fee Rate:', feeRate.toString(), 'basis points');
        
        // Check if mock token is supported
        const isSupported = await atomicSwap.supportedTokens(MOCK_TOKEN_ADDRESS).call();
        console.log('Mock Token Supported:', isSupported);
        
        // Check token details
        const tokenName = await mockToken.name().call();
        const tokenSymbol = await mockToken.symbol().call();
        const tokenSupply = await mockToken.totalSupply().call();
        
        console.log('\nMock Token Details:');
        console.log('Name:', tokenName);
        console.log('Symbol:', tokenSymbol);
        console.log('Total Supply:', tronWeb.BigNumber(tokenSupply).div(1e6).toString(), tokenSymbol);
        
        console.log('\n✅ Deployment verified successfully!');
        console.log('\nContract Addresses:');
        console.log('TronAtomicSwap:', ATOMIC_SWAP_ADDRESS);
        console.log('MockTRC20 (TUSDT):', MOCK_TOKEN_ADDRESS);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testDeployment();