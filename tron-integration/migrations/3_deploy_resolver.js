const TronResolver = artifacts.require('./TronResolver.sol');
const TronAtomicSwap = artifacts.require('./TronAtomicSwap.sol');

module.exports = async function (deployer, network) {
  // Get deployed TronAtomicSwap address
  const atomicSwap = await TronAtomicSwap.deployed();
  
  console.log('Deploying TronResolver...');
  console.log('Using TronAtomicSwap at:', atomicSwap.address);
  
  // Deploy TronResolver
  await deployer.deploy(TronResolver, atomicSwap.address);
  const resolver = await TronResolver.deployed();
  
  console.log('TronResolver deployed at:', resolver.address);
  
  // Output deployment summary
  console.log('\n=== Deployment Summary ===');
  console.log('TronAtomicSwap:', atomicSwap.address);
  console.log('TronResolver:', resolver.address);
  console.log('Network:', network);
};