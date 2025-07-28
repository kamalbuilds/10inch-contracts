use cosmwasm_std::{Addr, Coin, Timestamp};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub owner: Addr,
    pub atomic_swap_contract: Addr,
    pub bridge_contract: Addr,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ResolverOrder {
    pub order_id: u64,
    pub initiator: Addr,
    pub resolver: Addr,
    pub src_chain_id: u32,
    pub dst_chain_id: u32,
    pub src_amount: Coin,
    pub dst_amount: String, // Amount on destination chain (may be different token)
    pub dst_token: String, // Token address on destination chain
    pub dst_recipient: String, // Recipient address on destination chain
    pub safety_deposit: Coin,
    pub secret_hash: String,
    pub src_timelock: Timestamp,
    pub dst_timelock: Timestamp,
    pub src_deployed: bool,
    pub dst_deployed: bool,
    pub completed: bool,
    pub cancelled: bool,
    pub secret: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct EscrowImmutables {
    pub order_hash: String,
    pub src_chain_id: u32,
    pub dst_chain_id: u32,
    pub src_token: String,
    pub dst_token: String,
    pub src_amount: String,
    pub dst_amount: String,
    pub resolver: String,
    pub beneficiary: String,
    pub secret_hash: String,
    pub finality_timestamp: u64,
    pub resolver_timestamp: u64,
    pub beneficiary_timestamp: u64,
    pub safety_deposit: String,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const ORDER_COUNTER: Item<u64> = Item::new("order_counter");
pub const ORDERS: Map<u64, ResolverOrder> = Map::new("orders");
pub const SECRET_HASH_TO_ORDER_ID: Map<&str, u64> = Map::new("secret_hash_to_order_id");

// Chain IDs
pub const CHAIN_ID_COSMOS: u32 = 1;
pub const CHAIN_ID_ETHEREUM: u32 = 2;
pub const CHAIN_ID_BSC: u32 = 56;
pub const CHAIN_ID_POLYGON: u32 = 137;