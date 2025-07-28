use cosmwasm_std::{Coin, Timestamp};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::state::{ResolverOrder, EscrowImmutables};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub atomic_swap_contract: String,
    pub bridge_contract: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    DeploySrc {
        initiator: String,
        dst_chain_id: u32,
        dst_recipient: String,
        dst_token: String,
        src_amount: Coin,
        dst_amount: String,
        secret_hash: String,
        safety_deposit: Coin,
        timelock: u64, // seconds from now
    },
    DeployDst {
        order_id: u64,
        // Additional params for destination chain deployment
    },
    Withdraw {
        order_id: u64,
        secret: String,
        is_source_chain: bool,
    },
    Cancel {
        order_id: u64,
    },
    UpdateConfig {
        owner: Option<String>,
        atomic_swap_contract: Option<String>,
        bridge_contract: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},
    Order { order_id: u64 },
    OrderBySecretHash { secret_hash: String },
    OrdersByResolver { resolver: String, start_after: Option<u64>, limit: Option<u32> },
    OrdersByInitiator { initiator: String, start_after: Option<u64>, limit: Option<u32> },
    CanWithdraw { order_id: u64, user: String },
    CanCancel { order_id: u64 },
    GetEscrowImmutables { order_id: u64 },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ConfigResponse {
    pub owner: String,
    pub atomic_swap_contract: String,
    pub bridge_contract: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct OrderResponse {
    pub order: ResolverOrder,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct OrdersResponse {
    pub orders: Vec<ResolverOrder>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct CanWithdrawResponse {
    pub can_withdraw: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct CanCancelResponse {
    pub can_cancel: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct EscrowImmutablesResponse {
    pub immutables: EscrowImmutables,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}