import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Stellar Configuration
  stellar: {
    networkPassphrase: process.env.STELLAR_NETWORK === 'mainnet' 
      ? 'Public Global Stellar Network ; September 2015'
      : 'Test SDF Network ; September 2015',
    horizonUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    htlcContractId: process.env.STELLAR_HTLC_CONTRACT || 'CD2EASHUTYGI3WRKDUR77CNSMNC7X2YCOKEKB6FH7BGV4DWMXWJB7K2V',
    relayerContractId: process.env.STELLAR_RELAYER_CONTRACT || 'CAAMOQYTWUT5JTO3HNOO7RFCZJBKT6LMQRB7G7QP3TD627MQPHZBGUVL',
    resolverSecretKey: process.env.STELLAR_SECRET_KEY || '',
    nativeTokenContract: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  },
  
  // EVM Configuration
  evm: {
    networks: {
      sepolia: {
        rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',
        chainId: 11155111,
        htlcAddress: process.env.SEPOLIA_HTLC_ADDRESS || '0x067423CA883d8D54995735aDc1FA23c17e5b62cc',
        resolverPrivateKey: process.env.SEPOLIA_PRIVATE_KEY || ''
      },
      // Add more EVM networks here
    }
  },
  
  // Resolver Configuration
  resolver: {
    minProfitMargin: Number(process.env.MIN_PROFIT_MARGIN) || 0.01, // 1% minimum profit
    maxGasPrice: process.env.MAX_GAS_PRICE || '100', // Gwei
    monitoringInterval: Number(process.env.MONITORING_INTERVAL) || 5000, // 5 seconds
    safetyDepositMultiplier: Number(process.env.SAFETY_DEPOSIT_MULTIPLIER) || 1.5
  },
  
  // Redis Configuration (for caching and state management)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  },
  
  // API Configuration
  api: {
    port: Number(process.env.PORT) || 3000,
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000']
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};