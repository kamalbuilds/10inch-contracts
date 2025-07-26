import { sha256 as tonSha256 } from '@ton/crypto';
import { ethers } from 'ethers';

async function compareHashFunctions() {
    console.log('🔍 Comparing Hash Functions (TON vs Ethers)\n');
    
    // Test with a known 32-byte secret
    const testSecret = Buffer.alloc(32, 0x41); // All 'A' (0x41)
    console.log('Test Secret (hex):', testSecret.toString('hex'));
    console.log('Test Secret length:', testSecret.length, 'bytes');
    
    // Hash with TON crypto
    const tonHash = await tonSha256(testSecret);
    console.log('\n📱 TON SHA256:');
    console.log('Hash (Buffer):', tonHash);
    console.log('Hash (hex):', tonHash.toString('hex'));
    console.log('Hash length:', tonHash.length, 'bytes');
    
    // Hash with Ethers
    const ethersHash = ethers.sha256(testSecret);
    console.log('\n⚡ Ethers SHA256:');
    console.log('Hash (string):', ethersHash);
    console.log('Hash (no prefix):', ethersHash.slice(2));
    console.log('Hash length:', ethersHash.slice(2).length / 2, 'bytes');
    
    // Compare results
    console.log('\n🔍 Comparison:');
    const tonHex = tonHash.toString('hex');
    const ethersHex = ethersHash.slice(2); // Remove 0x prefix
    console.log('TON result   :', tonHex);
    console.log('Ethers result:', ethersHex);
    console.log('Hashes match :', tonHex === ethersHex);
    
    // Test with actual random secret like in cross-chain test
    console.log('\n=== Test with Random Secret ===');
    const randomSecret = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
        randomSecret[i] = Math.floor(Math.random() * 256);
    }
    
    console.log('Random Secret:', randomSecret.toString('hex'));
    
    const tonRandomHash = await tonSha256(randomSecret);
    const ethersRandomHash = ethers.sha256(randomSecret);
    
    console.log('TON hash    :', tonRandomHash.toString('hex'));
    console.log('Ethers hash :', ethersRandomHash.slice(2));
    console.log('Match       :', tonRandomHash.toString('hex') === ethersRandomHash.slice(2));
    
    // Test with Buffer vs Uint8Array vs hex string
    console.log('\n=== Test Different Input Types ===');
    const testData = Buffer.from('Hello World!Hello World!00000000'); // 32 bytes
    
    // As Buffer
    const bufferHash = ethers.sha256(testData);
    console.log('Buffer input:', bufferHash);
    
    // As hex string
    const hexHash = ethers.sha256('0x' + testData.toString('hex'));
    console.log('Hex input   :', hexHash);
    
    // As Uint8Array
    const uint8Hash = ethers.sha256(new Uint8Array(testData));
    console.log('Uint8 input :', uint8Hash);
    
    console.log('All equal   :', bufferHash === hexHash && hexHash === uint8Hash);
}

compareHashFunctions().catch(console.error);