use cosmwasm_std::{Addr, Coin, Timestamp, Uint128, IbcEndpoint};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub owner: Addr,
    pub protocol_fee_bps: u64,
    pub min_timelock_duration: u64,
    pub max_timelock_duration: u64,
    pub ibc_timeout_seconds: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ChainConfig {
    pub chain_id: u32,
    pub chain_name: String,
    pub ibc_channel: String,
    pub is_active: bool,
    pub fee_multiplier: u64, // basis points for chain-specific fees
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct BridgeOrder {
    pub order_id: String,
    pub initiator: Addr,
    pub source_chain_id: u32,
    pub target_chain_id: u32,
    pub recipient: String, // Can be non-Cosmos address
    pub amount: Coin,
    pub secret_hash: String,
    pub timelock: Timestamp,
    pub status: OrderStatus,
    pub created_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub secret: Option<String>,
    pub ibc_packet_sequence: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub enum OrderStatus {
    Pending,
    Active,
    Completed,
    Refunded,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IbcTransfer {
    pub order_id: String,
    pub packet_sequence: u64,
    pub channel_id: String,
    pub sender: Addr,
    pub receiver: String,
    pub amount: Coin,
    pub timeout_timestamp: Timestamp,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const CHAIN_CONFIGS: Map<u32, ChainConfig> = Map::new("chain_configs");
pub const BRIDGE_ORDERS: Map<&str, BridgeOrder> = Map::new("bridge_orders");
pub const ORDER_COUNTER: Item<u64> = Item::new("order_counter");
pub const IBC_TRANSFERS: Map<u64, IbcTransfer> = Map::new("ibc_transfers");

// Chain IDs for supported networks
pub const CHAIN_ID_COSMOS: u32 = 1;
pub const CHAIN_ID_ETHEREUM: u32 = 2;
pub const CHAIN_ID_BSC: u32 = 56;
pub const CHAIN_ID_POLYGON: u32 = 137;
pub const CHAIN_ID_ARBITRUM: u32 = 42161;
pub const CHAIN_ID_OPTIMISM: u32 = 10;