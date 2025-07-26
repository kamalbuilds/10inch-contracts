use soroban_sdk::{contracttype, Address, BytesN, String};

/// Represents the state of an atomic swap
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SwapState {
    pub id: u64,
    pub initiator: Address,
    pub recipient: Address,
    pub amount: i128,
    pub token_address: Address,
    pub secret_hash: BytesN<32>,
    pub timelock: u64,
    pub status: SwapStatus,
    pub created_at: u64,
    pub completed_at: u64,
}

/// Swap status enumeration
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SwapStatus {
    Active = 0,
    Completed = 1,
    Refunded = 2,
    Expired = 3,
}

/// Bridge order for cross-chain swaps
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BridgeOrder {
    pub id: u64,
    pub source_chain_id: u32,
    pub destination_chain_id: u32,
    pub initiator: Address,
    pub recipient: String,
    pub source_amount: i128,
    pub min_destination_amount: i128,
    pub token_address: Address,
    pub secret_hash: BytesN<32>,
    pub timelock: u64,
    pub status: BridgeStatus,
    pub created_at: u64,
    pub completed_at: u64,
    pub source_tx_hash: String,
    pub destination_tx_hash: String,
}

/// Bridge order status
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BridgeStatus {
    Pending = 0,
    Completed = 1,
    Cancelled = 2,
    Expired = 3,
}

/// Supported blockchain identifiers
pub const CHAIN_STELLAR: u32 = 1;
pub const CHAIN_ETHEREUM: u32 = 2; 
pub const CHAIN_BITCOIN: u32 = 3;
pub const CHAIN_APTOS: u32 = 4;
pub const CHAIN_SUI: u32 = 5;
pub const CHAIN_POLYGON: u32 = 6;
pub const CHAIN_ARBITRUM: u32 = 7;
pub const CHAIN_OPTIMISM: u32 = 8;
pub const CHAIN_BSC: u32 = 9;
pub const CHAIN_AVALANCHE: u32 = 10;

// Event symbols will be created using Symbol::new(&env, "...") when needed

// Storage key strings
pub const STORAGE_SWAP_COUNTER: &str = "swap_counter";
pub const STORAGE_BRIDGE_COUNTER: &str = "bridge_counter";
pub const STORAGE_ADMIN: &str = "admin";
pub const STORAGE_PROTOCOL_FEE: &str = "protocol_fee";
pub const STORAGE_SUPPORTED_CHAINS: &str = "supported_chains";

/// Constants for protocol parameters
pub const MIN_TIMELOCK_DURATION: u64 = 3600; // 1 hour in seconds
pub const MAX_TIMELOCK_DURATION: u64 = 86400; // 24 hours in seconds
pub const PROTOCOL_FEE_RATE: u32 = 50; // 0.5% in basis points
pub const SECRET_HASH_LENGTH: usize = 32; 