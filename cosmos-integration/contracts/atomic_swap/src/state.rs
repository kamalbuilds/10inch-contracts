use cosmwasm_std::{Addr, Coin, Timestamp};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub owner: Addr,
    pub protocol_fee_bps: u64, // basis points (e.g., 50 = 0.5%)
    pub min_timelock_duration: u64, // seconds
    pub max_timelock_duration: u64, // seconds
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Swap {
    pub id: String,
    pub initiator: Addr,
    pub recipient: Addr,
    pub amount: Coin,
    pub secret_hash: String,
    pub timelock: Timestamp,
    pub status: SwapStatus,
    pub created_at: Timestamp,
    pub completed_at: Option<Timestamp>,
    pub secret: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub enum SwapStatus {
    Active,
    Completed,
    Refunded,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const SWAPS: Map<&str, Swap> = Map::new("swaps");
pub const SWAP_COUNTER: Item<u64> = Item::new("swap_counter");