use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Coin, CosmosMsg, Deps, DepsMut, Env, MessageInfo,
    Order, Response, StdResult, Uint128, BankMsg,
};
use cw2::set_contract_version;
use cw_storage_plus::Bound;
use sha2::{Sha256, Digest};

use crate::error::ContractError;
use crate::msg::{
    ConfigResponse, ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg, SwapResponse,
    SwapsResponse, VerifySecretResponse,
};
use crate::state::{Config, Swap, SwapStatus, CONFIG, SWAPS, SWAP_COUNTER};

const CONTRACT_NAME: &str = "crates.io:cosmos-atomic-swap";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

const DEFAULT_LIMIT: u32 = 10;
const MAX_LIMIT: u32 = 100;

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let config = Config {
        owner: info.sender,
        protocol_fee_bps: msg.protocol_fee_bps,
        min_timelock_duration: msg.min_timelock_duration,
        max_timelock_duration: msg.max_timelock_duration,
    };

    CONFIG.save(deps.storage, &config)?;
    SWAP_COUNTER.save(deps.storage, &0u64)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", config.owner))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::CreateSwap {
            recipient,
            secret_hash,
            timelock,
        } => execute_create_swap(deps, env, info, recipient, secret_hash, timelock),
        ExecuteMsg::CompleteSwap { swap_id, secret } => {
            execute_complete_swap(deps, env, info, swap_id, secret)
        }
        ExecuteMsg::RefundSwap { swap_id } => execute_refund_swap(deps, env, info, swap_id),
        ExecuteMsg::UpdateConfig {
            owner,
            protocol_fee_bps,
            min_timelock_duration,
            max_timelock_duration,
        } => execute_update_config(
            deps,
            info,
            owner,
            protocol_fee_bps,
            min_timelock_duration,
            max_timelock_duration,
        ),
        ExecuteMsg::WithdrawFees { recipient } => execute_withdraw_fees(deps, env, info, recipient),
    }
}

pub fn execute_create_swap(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    recipient: String,
    secret_hash: String,
    timelock_seconds: u64,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    
    // Validate timelock
    if timelock_seconds < config.min_timelock_duration || timelock_seconds > config.max_timelock_duration {
        return Err(ContractError::InvalidTimelock {
            min: config.min_timelock_duration,
            max: config.max_timelock_duration,
        });
    }

    // Validate secret hash format (64 hex chars for SHA256)
    if secret_hash.len() != 64 || !secret_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ContractError::InvalidSecretHash {});
    }

    // Validate payment
    if info.funds.is_empty() {
        return Err(ContractError::InvalidAmount {});
    }
    
    let payment = &info.funds[0];
    if payment.amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }

    let recipient_addr = deps.api.addr_validate(&recipient)?;
    
    // Generate swap ID
    let counter = SWAP_COUNTER.load(deps.storage)?;
    let swap_id = format!("swap_{}", counter);
    SWAP_COUNTER.save(deps.storage, &(counter + 1))?;

    // Calculate timelock
    let timelock = env.block.time.plus_seconds(timelock_seconds);

    // Create swap
    let swap = Swap {
        id: swap_id.clone(),
        initiator: info.sender.clone(),
        recipient: recipient_addr.clone(),
        amount: payment.clone(),
        secret_hash: secret_hash.clone(),
        timelock,
        status: SwapStatus::Active,
        created_at: env.block.time,
        completed_at: None,
        secret: None,
    };

    SWAPS.save(deps.storage, &swap_id, &swap)?;

    Ok(Response::new()
        .add_attribute("action", "create_swap")
        .add_attribute("swap_id", swap_id)
        .add_attribute("initiator", info.sender)
        .add_attribute("recipient", recipient)
        .add_attribute("amount", payment.amount.to_string())
        .add_attribute("denom", &payment.denom)
        .add_attribute("secret_hash", secret_hash)
        .add_attribute("timelock", timelock.to_string()))
}

pub fn execute_complete_swap(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    swap_id: String,
    secret: String,
) -> Result<Response, ContractError> {
    let mut swap = SWAPS.load(deps.storage, &swap_id)?;

    // Check status
    match swap.status {
        SwapStatus::Active => {}
        SwapStatus::Completed => return Err(ContractError::SwapAlreadyCompleted {}),
        SwapStatus::Refunded => return Err(ContractError::SwapAlreadyRefunded {}),
    }

    // Check timelock
    if env.block.time >= swap.timelock {
        return Err(ContractError::TimelockExpired {});
    }

    // Verify secret
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    let computed_hash = format!("{:x}", hasher.finalize());
    
    if computed_hash != swap.secret_hash {
        return Err(ContractError::InvalidSecret {});
    }

    // Update swap status
    swap.status = SwapStatus::Completed;
    swap.completed_at = Some(env.block.time);
    swap.secret = Some(secret.clone());
    SWAPS.save(deps.storage, &swap_id, &swap)?;

    // Calculate fees
    let config = CONFIG.load(deps.storage)?;
    let fee_amount = swap.amount.amount * Uint128::from(config.protocol_fee_bps) / Uint128::from(10000u64);
    let transfer_amount = swap.amount.amount - fee_amount;

    // Create transfer message
    let transfer_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: swap.recipient.to_string(),
        amount: vec![Coin {
            denom: swap.amount.denom.clone(),
            amount: transfer_amount,
        }],
    });

    Ok(Response::new()
        .add_message(transfer_msg)
        .add_attribute("action", "complete_swap")
        .add_attribute("swap_id", swap_id)
        .add_attribute("recipient", swap.recipient)
        .add_attribute("amount", transfer_amount.to_string())
        .add_attribute("fee", fee_amount.to_string())
        .add_attribute("secret", secret))
}

pub fn execute_refund_swap(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    swap_id: String,
) -> Result<Response, ContractError> {
    let mut swap = SWAPS.load(deps.storage, &swap_id)?;

    // Only initiator can refund
    if info.sender != swap.initiator {
        return Err(ContractError::Unauthorized {});
    }

    // Check status
    match swap.status {
        SwapStatus::Active => {}
        SwapStatus::Completed => return Err(ContractError::SwapAlreadyCompleted {}),
        SwapStatus::Refunded => return Err(ContractError::SwapAlreadyRefunded {}),
    }

    // Check timelock
    if env.block.time < swap.timelock {
        return Err(ContractError::TimelockNotExpired {});
    }

    // Update swap status
    swap.status = SwapStatus::Refunded;
    swap.completed_at = Some(env.block.time);
    SWAPS.save(deps.storage, &swap_id, &swap)?;

    // Create refund message
    let refund_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: swap.initiator.to_string(),
        amount: vec![swap.amount.clone()],
    });

    Ok(Response::new()
        .add_message(refund_msg)
        .add_attribute("action", "refund_swap")
        .add_attribute("swap_id", swap_id)
        .add_attribute("initiator", swap.initiator)
        .add_attribute("amount", swap.amount.amount.to_string()))
}

pub fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    owner: Option<String>,
    protocol_fee_bps: Option<u64>,
    min_timelock_duration: Option<u64>,
    max_timelock_duration: Option<u64>,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    // Only owner can update
    if info.sender != config.owner {
        return Err(ContractError::Unauthorized {});
    }

    if let Some(owner) = owner {
        config.owner = deps.api.addr_validate(&owner)?;
    }

    if let Some(fee_bps) = protocol_fee_bps {
        config.protocol_fee_bps = fee_bps;
    }

    if let Some(min_duration) = min_timelock_duration {
        config.min_timelock_duration = min_duration;
    }

    if let Some(max_duration) = max_timelock_duration {
        config.max_timelock_duration = max_duration;
    }

    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new().add_attribute("action", "update_config"))
}

pub fn execute_withdraw_fees(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    recipient: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // Only owner can withdraw fees
    if info.sender != config.owner {
        return Err(ContractError::Unauthorized {});
    }

    let recipient_addr = deps.api.addr_validate(&recipient)?;
    
    // Get all contract balances
    let balances = deps.querier.query_all_balances(&env.contract.address)?;
    
    if balances.is_empty() {
        return Err(ContractError::InsufficientFunds {});
    }

    // Create transfer messages for all balances
    let transfer_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: recipient_addr.to_string(),
        amount: balances,
    });

    Ok(Response::new()
        .add_message(transfer_msg)
        .add_attribute("action", "withdraw_fees")
        .add_attribute("recipient", recipient))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::Swap { swap_id } => to_json_binary(&query_swap(deps, swap_id)?),
        QueryMsg::SwapsByInitiator { initiator, start_after, limit } => {
            to_json_binary(&query_swaps_by_initiator(deps, initiator, start_after, limit)?)
        }
        QueryMsg::SwapsByRecipient { recipient, start_after, limit } => {
            to_json_binary(&query_swaps_by_recipient(deps, recipient, start_after, limit)?)
        }
        QueryMsg::SwapsByStatus { status, start_after, limit } => {
            to_json_binary(&query_swaps_by_status(deps, status, start_after, limit)?)
        }
        QueryMsg::VerifySecret { secret, secret_hash } => {
            to_json_binary(&query_verify_secret(secret, secret_hash))
        }
    }
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        owner: config.owner.to_string(),
        protocol_fee_bps: config.protocol_fee_bps,
        min_timelock_duration: config.min_timelock_duration,
        max_timelock_duration: config.max_timelock_duration,
    })
}

fn query_swap(deps: Deps, swap_id: String) -> StdResult<SwapResponse> {
    let swap = SWAPS.load(deps.storage, &swap_id)?;
    Ok(SwapResponse { swap })
}

fn query_swaps_by_initiator(
    deps: Deps,
    initiator: String,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<SwapsResponse> {
    let initiator_addr = deps.api.addr_validate(&initiator)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.as_deref().map(Bound::exclusive);
    
    let swaps: Vec<Swap> = SWAPS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit)
        .filter_map(|item| {
            item.ok().and_then(|(_, swap)| {
                if swap.initiator == initiator_addr {
                    Some(swap)
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(SwapsResponse { swaps })
}

fn query_swaps_by_recipient(
    deps: Deps,
    recipient: String,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<SwapsResponse> {
    let recipient_addr = deps.api.addr_validate(&recipient)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.as_deref().map(Bound::exclusive);
    
    let swaps: Vec<Swap> = SWAPS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit)
        .filter_map(|item| {
            item.ok().and_then(|(_, swap)| {
                if swap.recipient == recipient_addr {
                    Some(swap)
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(SwapsResponse { swaps })
}

fn query_swaps_by_status(
    deps: Deps,
    status: SwapStatus,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<SwapsResponse> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.as_deref().map(Bound::exclusive);
    
    let swaps: Vec<Swap> = SWAPS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit)
        .filter_map(|item| {
            item.ok().and_then(|(_, swap)| {
                if swap.status == status {
                    Some(swap)
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(SwapsResponse { swaps })
}

fn query_verify_secret(secret: String, secret_hash: String) -> VerifySecretResponse {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    let computed_hash = format!("{:x}", hasher.finalize());
    
    VerifySecretResponse {
        is_valid: computed_hash == secret_hash,
    }
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn migrate(_deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    Ok(Response::new())
}