import { NetworkConfig } from './types';

export const MAINNET_CONFIG: NetworkConfig = {
  rpcEndpoint: 'https://rpc.osmosis.zone',
  chainId: 'osmosis-1',
  prefix: 'osmo',
  gasPrice: '0.025uosmo',
};

export const TESTNET_CONFIG: NetworkConfig = {
  rpcEndpoint: 'https://rpc-palvus.pion-1.ntrn.tech',
  chainId: 'pion-1',
  prefix: 'neutron',
  gasPrice: '0.025untrn',
};

export const LOCAL_CONFIG: NetworkConfig = {
  rpcEndpoint: 'http://localhost:26657',
  chainId: 'localnet',
  prefix: 'cosmos',
  gasPrice: '0.025stake',
};

export const CONTRACT_NAMES = {
  ATOMIC_SWAP: 'cosmos-atomic-swap',
  CROSS_CHAIN_BRIDGE: 'cosmos-cross-chain-bridge',
  RESOLVER: 'cosmos-resolver',
};

export const DEFAULT_GAS_LIMITS = {
  CREATE_SWAP: 200000,
  COMPLETE_SWAP: 150000,
  REFUND_SWAP: 150000,
  CREATE_BRIDGE_ORDER: 250000,
  COMPLETE_BRIDGE_ORDER: 200000,
  REFUND_BRIDGE_ORDER: 200000,
  UPDATE_CONFIG: 100000,
};

export const PROTOCOL_FEE_BPS = 50; // 0.5%

export const IBC_TIMEOUT_SECONDS = 600; // 10 minutes

export const SUPPORTED_DENOMS = [
  'untrn',
  'uosmo',
  'uatom',
  'ujuno',
  'ustars',
  'uakt',
  'uluna',
  'uscrt',
  'uregen',
  'uion',
  'uxprt',
];

export const IBC_CHANNELS = {
  ETHEREUM: 'channel-0', // Example channel ID
  BSC: 'channel-1',
  POLYGON: 'channel-2',
  ARBITRUM: 'channel-3',
  OPTIMISM: 'channel-4',
} as const;


export const CHAIN_IDS = {
  COSMOS: 'pion-1',
  ETHEREUM_SEPOLIA: 11155111,
  POLYGON_MUMBAI: 80001,
  ARBITRUM_SEPOLIA: 42161,
  OPTIMISM_SEPOLIA: 10,
} as const;