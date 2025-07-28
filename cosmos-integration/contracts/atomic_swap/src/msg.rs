use cosmwasm_std::{};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::state::{Swap, SwapStatus};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub protocol_fee_bps: u64,
    pub min_timelock_duration: u64,
    pub max_timelock_duration: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    CreateSwap {
        recipient: String,
        secret_hash: String,
        timelock: u64, // seconds from now
    },
    CompleteSwap {
        swap_id: String,
        secret: String,
    },
    RefundSwap {
        swap_id: String,
    },
    UpdateConfig {
        owner: Option<String>,
        protocol_fee_bps: Option<u64>,
        min_timelock_duration: Option<u64>,
        max_timelock_duration: Option<u64>,
    },
    WithdrawFees {
        recipient: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},
    Swap { swap_id: String },
    SwapsByInitiator { initiator: String, start_after: Option<String>, limit: Option<u32> },
    SwapsByRecipient { recipient: String, start_after: Option<String>, limit: Option<u32> },
    SwapsByStatus { status: SwapStatus, start_after: Option<String>, limit: Option<u32> },
    VerifySecret { secret: String, secret_hash: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ConfigResponse {
    pub owner: String,
    pub protocol_fee_bps: u64,
    pub min_timelock_duration: u64,
    pub max_timelock_duration: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SwapResponse {
    pub swap: Swap,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SwapsResponse {
    pub swaps: Vec<Swap>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct VerifySecretResponse {
    pub is_valid: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}