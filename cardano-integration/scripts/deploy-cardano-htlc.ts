import * as dotenv from 'dotenv';
import { Blockfrost, Lucid, fromText, toUnit, Data, Script } from 'lucid-cardano';

dotenv.config();

// HTLC Datum Schema
const HTLCDatum = Data.Object({
  secretHash: Data.Bytes(),
  recipient: Data.Bytes(),
  sender: Data.Bytes(), 
  timeout: Data.Integer(),
  amount: Data.Integer(),
  minPartialAmount: Data.Integer(),
});

// HTLC Redeemer Schema
const HTLCRedeemer = Data.Enum([
  Data.Object({
    secret: Data.Bytes(),
    partialAmount: Data.Nullable(Data.Integer()),
  }),
  Data.Void(), // ClaimTimeout
]);

// Mock compiled validator (in production, this would be from Aiken build)
// This is a simple always-succeeds validator for demonstration
const MOCK_VALIDATOR_CBOR = "59079559079201000033232323232323232323232323232332232323232323232223232533532323232325335323235002222222222222533533355301b12001321233001225335002210031001002502f25335333573466e3c0380040ec0e84d40b8004540b4010840ec40e4d401888cccd5cd19b8735573aa004900011991091980080180118059aba1500233500b014357426ae8940088c98c80a8cd5ce01501481389aab9e5001137540026aae78400c8cccd5cd19b875002480088c8488c00400cdd71aba135573ca008464c6405866ae700b40b00ac0a84d55cf280089baa001357426ae8940088c98c80a0cd5ce01481401309aab9e5001137540022464646666ae68cdc39aab9d5002480008cc8848cc00400c008c088d5d0a80118029aba135744a004464c6405466ae700ac0a80a40a04d55cf280089baa00135742a01466a02602c6ae85401cccd5405dd69aba150063232323333573466e1cd55cea801240004664424660020060046464646666ae68cdc39aab9d5002480008cc8848cc00400c008cd40add69aba15002302a357426ae8940088c98c809ccd5ce01401381289aab9e5001137540026ae854008c8c8c8cccd5cd19b8735573aa004900011991091980080180119a8123ad35742a00460586ae84d5d1280111931901419ab9c029028026135573ca00226ea8004d5d09aba2500223263202833573805205004c04626aae7940044dd50009aba1500533501475c6ae854010ccd5405c0848004d5d0a801999aa80b3ae200135742a00460426ae84d5d1280111931900f19ab9c01f01e01c135744a00226ae8940044d5d1280089aba25001135744a00226ae8940044d5d1280089aba25001135744a00226ae8940044d55cf280089baa00135742a00860226ae84d55cf280189aba25002135573ca00226ea80048c94ccd5cd19b8735573aa002900011bae357426aae7940088c98c8058cd5ce00b80b00a00a89931900919ab9c49010350543500012135573ca00226ea8004c8004d5405488448894cd40044d400c88004884ccd401488008c010008ccd54c01c4800401401000448c88c008dd6000990009aa80a111999aab9f0012500a233500930043574200460066ae880080448c8c8cccd5cd19b8735573aa004900011991091980080180118029aba150023005357426ae8940088c98c8040cd5ce00880800709aab9e5001137540024464646666ae68cdc39aab9d5004480008cccc888848cccc00401401000c008c8c8c8cccd5cd19b8735573aa0049000119910919800801801180a9aba1500233500f014357426ae8940088c98c8054cd5ce00b00a80989aab9e5001137540026ae854010ccd54021d728039aba150033232323333573466e1d4005200423212223002004357426aae79400c8cccd5cd19b875002480088c84888c004010dd71aba135573ca00846666ae68cdc3a801a400042444006464c6403466ae7006c06806406005c4d55cea80089baa00135742a00466a016eb8d5d09aba2500223263201633573802e02c02826ae8940044d5d1280089aab9e500113754002266aa002eb9d6889119118011bab00132001355012223233335573e0044a010466a00e66442466002006004600c6aae754008c014d55cf280118021aba200301213574200222440042442446600200800624464646666ae68cdc3a800a40004642446004006600a6ae84d55cf280191999ab9a3370ea0049001109100091931900899ab9c01201100f00e00d135573aa00226ea80048c8c8cccd5cd19b875001480188c848888c010014c01cd5d09aab9e500323333573466e1d400920042321222230020053009357426aae7940108cccd5cd19b875003480088c848888c004014c01cd5d09aab9e500523333573466e1d40112000232122223003005375c6ae84d55cf280311931900899ab9c01201100f00e00d00c00b135573aa00226ea80048c8c8cccd5cd19b8735573aa004900011991091980080180118029aba15002375a6ae84d5d1280111931900699ab9c00e00d00b135573ca00226ea80048c8cccd5cd19b8735573aa002900011bae357426aae7940088c98c8028cd5ce00580500409baa001232323232323333573466e1d4005200c21222222200323333573466e1d4009200a21222222200423333573466e1d400d2008233221222222233001009008375c6ae854014dd69aba135744a00a46666ae68cdc3a8022400c4664424444444660040120106eb8d5d0a8039bae357426ae89401c8cccd5cd19b875005480108cc8848888888cc018024020c030d5d0a8049bae357426ae8940248cccd5cd19b875006480088c848888888c01c020c034d5d09aab9e500b23333573466e1d401d2000232122222223005008300e357426aae7940308c98c804ccd5ce00a00980880800780700680600589aab9d5004135573ca00626aae7940084d55cf280089baa0012323232323333573466e1d400520022333222122333001005004003375a6ae854010dd69aba15003375a6ae84d5d1280191999ab9a3370ea0049000119091180100198041aba135573ca00c464c6401866ae700340300280244d55cea80189aba25001135573ca00226ea80048c8c8cccd5cd19b875001480088c8488c00400cdd71aba135573ca00646666ae68cdc3a8012400046424460040066eb8d5d09aab9e500423263200933573801401200e00c26aae7540044dd500089119191999ab9a3370ea00290021091100091999ab9a3370ea00490011190911180180218031aba135573ca00846666ae68cdc3a801a400042444004464c6401466ae7002c02802001c0184d55cea80089baa0012323333573466e1d40052002200723333573466e1d40092000200723263200633573801000c00800626aae74dd5000a4c24002920103505431001122002122001112323001001223300330020020011";

async function deployCardanoHTLC() {
  console.log('🚀 Deploying HTLC to Cardano Preprod\n');
  console.log('━'.repeat(60));

  try {
    // Initialize Lucid with Blockfrost
    const lucid = await Lucid.new(
      new Blockfrost(
        process.env.BLOCKFROST_URL!,
        process.env.BLOCKFROST_API_KEY!
      ),
      "Preprod"
    );

    // Load wallet from seed phrase
    console.log('📱 Loading wallet from seed phrase...');
    const seedPhrase = process.env.CARDANO_SEED_PHRASE!;
    lucid.selectWalletFromSeed(seedPhrase);
    
    const address = await lucid.wallet.address();
    console.log('✅ Wallet loaded:', address);
    
    // Check balance
    const utxos = await lucid.wallet.getUtxos();
    const balance = utxos.reduce((sum, utxo) => sum + BigInt(utxo.assets.lovelace), 0n);
    console.log('💰 Balance:', Number(balance) / 1_000_000, 'ADA\n');

    // Create validator script
    console.log('📝 Creating HTLC validator...');
    const validator: Script = {
      type: "PlutusV2",
      script: MOCK_VALIDATOR_CBOR,
    };

    // Get validator address
    const validatorAddress = lucid.utils.validatorToAddress(validator);
    console.log('✅ Validator address:', validatorAddress);
    console.log('\n⚠️  Note: Using mock validator for demonstration');
    console.log('   Real Aiken validator compilation pending\n');

    // Create HTLC matching the Sepolia one
    console.log('🔄 Creating HTLC to match Sepolia swap...');
    
    // Match the Sepolia HTLC parameters
    const secretHash = "994e2f129ffd7df2a3d625ea06783ee5425662d811f324984708591ca6cdff2c";
    const amount = 20_000_000n; // 20 ADA
    const timeout = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    
    const datum = Data.to({
      secretHash: secretHash,
      recipient: lucid.utils.getAddressDetails(address).paymentCredential!.hash,
      sender: lucid.utils.getAddressDetails(address).paymentCredential!.hash,
      timeout: BigInt(timeout),
      amount: amount,
      minPartialAmount: amount / 10n, // 10% minimum
    }, HTLCDatum);

    console.log('\n📊 HTLC Parameters:');
    console.log('- Amount:', Number(amount) / 1_000_000, 'ADA');
    console.log('- Secret Hash:', secretHash);
    console.log('- Timeout:', new Date(timeout * 1000).toLocaleString());

    // Build transaction
    console.log('\n🔨 Building transaction...');
    const tx = await lucid
      .newTx()
      .payToContract(validatorAddress, { inline: datum }, { lovelace: amount })
      .complete();

    console.log('✅ Transaction built');
    
    // Sign transaction
    console.log('🖊️  Signing transaction...');
    const signedTx = await tx.sign().complete();
    
    // Submit transaction
    console.log('📤 Submitting transaction...');
    const txHash = await signedTx.submit();
    
    console.log('✅ Transaction submitted!');
    console.log('📋 Transaction hash:', txHash);
    console.log('🔗 View on Cardanoscan: https://preprod.cardanoscan.io/transaction/' + txHash);
    
    console.log('\n📊 Summary:');
    console.log('- HTLC created on Cardano Preprod');
    console.log('- Matching Sepolia HTLC secret hash');
    console.log('- Ready for atomic swap completion');
    
    console.log('\n🎯 Next Steps:');
    console.log('1. Claim on Cardano with the secret from Sepolia');
    console.log('2. Use revealed secret to claim on Sepolia');
    console.log('3. Complete the atomic swap!');

    // Save deployment info
    const deploymentInfo = {
      validatorAddress,
      txHash,
      datum: {
        secretHash,
        amount: Number(amount) / 1_000_000 + ' ADA',
        timeout: new Date(timeout * 1000).toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    console.log('\n💾 Deployment info:', JSON.stringify(deploymentInfo, null, 2));

  } catch (error) {
    console.error('❌ Deployment failed:', error);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Ensure Blockfrost API key is valid');
    console.log('2. Check wallet has sufficient ADA');
    console.log('3. Verify seed phrase is correct');
  }
}

// Run deployment
deployCardanoHTLC().catch(console.error);