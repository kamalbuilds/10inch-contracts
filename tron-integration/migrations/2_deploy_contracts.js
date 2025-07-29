const TronAtomicSwap = artifacts.require('./TronAtomicSwap.sol');
const MockTRC20 = artifacts.require('./MockTRC20.sol');

module.exports = async function (deployer, network) {
  // For Tron, we need to use the TronWeb instance to get the default address
  const TronWeb = require('tronweb');
  const tronWeb = new TronWeb({
    fullHost: 'https://api.shasta.trongrid.io',
    privateKey: process.env.PRIVATE_KEY_SHASTA.replace(/['"]/g, '')
  });
  
  const adminAddress = tronWeb.defaultAddress.base58;
  console.log('Deploying with admin address:', adminAddress);
  
  const protocolFeeRate = 50; // 0.5% in basis points
  
  // Deploy TronAtomicSwap contract
  await deployer.deploy(TronAtomicSwap, adminAddress, protocolFeeRate);
  const atomicSwap = await TronAtomicSwap.deployed();
  
  console.log('TronAtomicSwap deployed at:', atomicSwap.address);
  
  // Deploy MockTRC20 for testing on testnet
  if (network === 'shasta' || network === 'nile') {
    await deployer.deploy(MockTRC20, 'Test USDT', 'TUSDT', '1000000000000');
    const testToken = await MockTRC20.deployed();
    console.log('MockTRC20 (TUSDT) deployed at:', testToken.address);
    
    // Add the test token as supported
    await atomicSwap.addSupportedToken(testToken.address);
    console.log('Test token added as supported');
  }
};