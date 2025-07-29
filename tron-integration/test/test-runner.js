#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 1inch Fusion Plus Tron Integration Test Suite');
console.log('='.repeat(60));

const testFiles = [
  'TronAtomicSwap.test.js',
  'FusionPlusIntegration.test.js'
];

async function runTests() {
  console.log('\n📋 Test Configuration:');
  console.log('- Network: Development (TronBox)');
  console.log('- Solidity Version: 0.8.23');
  console.log('- Test Framework: Mocha + Chai');
  console.log('- Contract: TronAtomicSwap + MockTRC20');
  console.log('\n' + '='.repeat(60));

  // Check if contracts are compiled
  const buildDir = path.join(__dirname, '..', 'build', 'contracts');
  if (!fs.existsSync(buildDir)) {
    console.log('\n⚠️  Build directory not found. Compiling contracts first...');
    await runCommand('tronbox compile');
  }

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const startTime = Date.now();

  for (const testFile of testFiles) {
    console.log(`\n🧪 Running ${testFile}...`);
    console.log('-'.repeat(40));
    
    try {
      const result = await runCommand(`tronbox test test/${testFile}`);
      console.log(result);
      
      // Parse test results (basic parsing)
      const passMatches = result.match(/(\d+) passing/);
      const failMatches = result.match(/(\d+) failing/);
      
      if (passMatches) {
        const passed = parseInt(passMatches[1]);
        totalTests += passed;
        passedTests += passed;
        console.log(`✅ ${passed} tests passed`);
      }
      
      if (failMatches) {
        const failed = parseInt(failMatches[1]);
        totalTests += failed;
        failedTests += failed;
        console.log(`❌ ${failed} tests failed`);
      }
      
    } catch (error) {
      console.error(`❌ Error running ${testFile}:`, error.message);
      failedTests++;
      totalTests++;
    }
  }

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;

  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`⏱️  Duration: ${duration.toFixed(2)}s`);
  console.log(`📈 Success Rate: ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}%`);

  if (failedTests === 0) {
    console.log('\n🎉 All tests passed! 1inch Fusion Plus Tron integration is working correctly.');
    console.log('\n✅ Contract Features Verified:');
    console.log('   - TRX atomic swaps');
    console.log('   - TRC20 token swaps');
    console.log('   - Cross-chain bridge orders');
    console.log('   - Protocol fee collection');
    console.log('   - Admin functions');
    console.log('   - Security features');
    console.log('   - Error handling');
    console.log('   - End-to-end integration');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Please review the output above.');
    process.exit(1);
  }
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout + stderr);
    });
  });
}

// Check command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('\nUsage: node test-runner.js [options]');
  console.log('\nOptions:');
  console.log('  --help, -h     Show this help message');
  console.log('  --compile, -c  Compile contracts before testing');
  console.log('  --verbose, -v  Show verbose output');
  console.log('\nExamples:');
  console.log('  node test-runner.js');
  console.log('  node test-runner.js --compile');
  console.log('  npm run test');
  process.exit(0);
}

if (args.includes('--compile') || args.includes('-c')) {
  console.log('\n🔨 Compiling contracts...');
  runCommand('tronbox compile')
    .then(() => {
      console.log('✅ Compilation completed');
      runTests();
    })
    .catch(error => {
      console.error('❌ Compilation failed:', error.message);
      process.exit(1);
    });
} else {
  runTests();
} 