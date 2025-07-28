// Copyright (c) 1inch Network
// SPDX-License-Identifier: MIT

/**
 * 1inch Fusion+ Sui Integration SDK
 * 
 * This package provides a comprehensive TypeScript SDK for interacting with
 * 1inch Fusion+ atomic swap and cross-chain bridge contracts on the Sui blockchain.
 */

// Main SDK class
import { SuiAtomicSwap } from './SuiAtomicSwap';

export { SuiAtomicSwap as default };
export { SuiAtomicSwap };

// Types and interfaces
export type {
    SuiNetwork,
    SwapState,
    BridgeOrder,
    ChainConfig,
    CreateSwapParams,
    CompleteSwapParams,
    CreateBridgeOrderParams,
    ProtocolStats,
    SuiAtomicSwapConfig,
} from './SuiAtomicSwap';

// Constants
export {
    SUI_NETWORKS,
    SUPPORTED_CHAINS,
    DEFAULT_SUI_COIN_TYPE,
    MIN_TIMELOCK_DURATION,
    MAX_TIMELOCK_DURATION,
    SECRET_LENGTH,
} from './SuiAtomicSwap';

// Version
export const VERSION = '1.0.0';

// Utilities
export const Utils = {
    generateSecret: () => SuiAtomicSwap.generateSecret(),
    generateHashlock: (secret: string) => SuiAtomicSwap.generateHashlock(secret),
    verifySecret: (secret: string, hashlock: string) => SuiAtomicSwap.verifySecret(secret, hashlock),
    getCurrentTimestamp: () => SuiAtomicSwap.getCurrentTimestamp(),
    calculateTimelock: (durationMinutes: number) => SuiAtomicSwap.calculateTimelock(durationMinutes),
    createTestAccount: (network?: string) => SuiAtomicSwap.createTestAccount(network),
}; 