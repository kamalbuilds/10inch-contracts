use cosmwasm_std::{Coin, Timestamp, IbcTimeout};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::state::{BridgeOrder, ChainConfig, OrderStatus};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub protocol_fee_bps: u64,
    pub min_timelock_duration: u64,
    pub max_timelock_duration: u64,
    pub ibc_timeout_seconds: u64,
    pub initial_chains: Vec<ChainConfig>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    CreateBridgeOrder {
        target_chain_id: u32,
        recipient: String,
        secret_hash: String,
        timelock: u64,
    },
    CompleteBridgeOrder {
        order_id: String,
        secret: String,
    },
    RefundBridgeOrder {
        order_id: String,
    },
    UpdateChainConfig {
        chain_id: u32,
        config: ChainConfig,
    },
    RemoveChainConfig {
        chain_id: u32,
    },
    UpdateConfig {
        owner: Option<String>,
        protocol_fee_bps: Option<u64>,
        min_timelock_duration: Option<u64>,
        max_timelock_duration: Option<u64>,
        ibc_timeout_seconds: Option<u64>,
    },
    WithdrawFees {
        recipient: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},
    ChainConfig { chain_id: u32 },
    AllChainConfigs { start_after: Option<u32>, limit: Option<u32> },
    BridgeOrder { order_id: String },
    OrdersByInitiator { initiator: String, start_after: Option<String>, limit: Option<u32> },
    OrdersByStatus { status: OrderStatus, start_after: Option<String>, limit: Option<u32> },
    OrdersByChain { chain_id: u32, start_after: Option<String>, limit: Option<u32> },
    VerifySecret { secret: String, secret_hash: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ConfigResponse {
    pub owner: String,
    pub protocol_fee_bps: u64,
    pub min_timelock_duration: u64,
    pub max_timelock_duration: u64,
    pub ibc_timeout_seconds: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ChainConfigResponse {
    pub config: ChainConfig,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ChainConfigsResponse {
    pub configs: Vec<(u32, ChainConfig)>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct BridgeOrderResponse {
    pub order: BridgeOrder,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct BridgeOrdersResponse {
    pub orders: Vec<BridgeOrder>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct VerifySecretResponse {
    pub is_valid: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}

// IBC Messages
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IbcExecuteMsg {
    pub order_id: String,
    pub secret: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct IbcAcknowledgement {
    pub success: bool,
    pub error: Option<String>,
}