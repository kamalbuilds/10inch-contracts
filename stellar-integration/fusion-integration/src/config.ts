export const config = {
  fusion: {
    apiUrl: process.env.FUSION_API_URL || 'https://fusion.1inch.io/v2.0',
    rpcUrl: process.env.FUSION_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo',
    resolverAddress: process.env.FUSION_RESOLVER_ADDRESS || '',
    resolverPrivateKey: process.env.FUSION_RESOLVER_PRIVATE_KEY || '',
    whitelistContract: process.env.FUSION_WHITELIST_CONTRACT || '0x7E6e10E34572c9D5FB8ff30d85E91aEce7366C2f',
    settlementContract: process.env.FUSION_SETTLEMENT_CONTRACT || '0x1111111254EEB25477B68fb85Ed929f73A960582',
  },
  stellar: {
    htlcContractId: process.env.STELLAR_HTLC_CONTRACT || '',
    relayerContractId: process.env.STELLAR_RELAYER_CONTRACT || '',
  }
};