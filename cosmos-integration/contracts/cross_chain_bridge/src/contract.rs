use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Coin, CosmosMsg, Deps, DepsMut, Env, IbcMsg,
    IbcTimeout, MessageInfo, Order, Response, StdResult, Timestamp, Uint128, BankMsg,
};
use cw2::set_contract_version;
use cw_storage_plus::Bound;
use sha2::{Sha256, Digest};

use crate::error::ContractError;
use crate::msg::{
    BridgeOrderResponse, BridgeOrdersResponse, ChainConfigResponse, ChainConfigsResponse,
    ConfigResponse, ExecuteMsg, IbcExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg,
    VerifySecretResponse,
};
use crate::state::{
    BridgeOrder, ChainConfig, Config, IbcTransfer, OrderStatus, BRIDGE_ORDERS, CHAIN_CONFIGS,
    CONFIG, IBC_TRANSFERS, ORDER_COUNTER, CHAIN_ID_COSMOS,
};

const CONTRACT_NAME: &str = "crates.io:cosmos-cross-chain-bridge";
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
        ibc_timeout_seconds: msg.ibc_timeout_seconds,
    };

    CONFIG.save(deps.storage, &config)?;
    ORDER_COUNTER.save(deps.storage, &0u64)?;

    // Save initial chain configurations
    for chain_config in msg.initial_chains {
        CHAIN_CONFIGS.save(deps.storage, chain_config.chain_id, &chain_config)?;
    }

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
        ExecuteMsg::CreateBridgeOrder {
            target_chain_id,
            recipient,
            secret_hash,
            timelock,
        } => execute_create_bridge_order(
            deps,
            env,
            info,
            target_chain_id,
            recipient,
            secret_hash,
            timelock,
        ),
        ExecuteMsg::CompleteBridgeOrder { order_id, secret } => {
            execute_complete_bridge_order(deps, env, info, order_id, secret)
        }
        ExecuteMsg::RefundBridgeOrder { order_id } => {
            execute_refund_bridge_order(deps, env, info, order_id)
        }
        ExecuteMsg::UpdateChainConfig { chain_id, config } => {
            execute_update_chain_config(deps, info, chain_id, config)
        }
        ExecuteMsg::RemoveChainConfig { chain_id } => {
            execute_remove_chain_config(deps, info, chain_id)
        }
        ExecuteMsg::UpdateConfig {
            owner,
            protocol_fee_bps,
            min_timelock_duration,
            max_timelock_duration,
            ibc_timeout_seconds,
        } => execute_update_config(
            deps,
            info,
            owner,
            protocol_fee_bps,
            min_timelock_duration,
            max_timelock_duration,
            ibc_timeout_seconds,
        ),
        ExecuteMsg::WithdrawFees { recipient } => execute_withdraw_fees(deps, env, info, recipient),
    }
}

pub fn execute_create_bridge_order(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    target_chain_id: u32,
    recipient: String,
    secret_hash: String,
    timelock_seconds: u64,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    
    // Validate target chain
    let target_chain = CHAIN_CONFIGS.load(deps.storage, target_chain_id)?;
    if !target_chain.is_active {
        return Err(ContractError::ChainNotSupported {});
    }

    // Validate timelock
    if timelock_seconds < config.min_timelock_duration || timelock_seconds > config.max_timelock_duration {
        return Err(ContractError::InvalidTimelock {
            min: config.min_timelock_duration,
            max: config.max_timelock_duration,
        });
    }

    // Validate secret hash
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

    // Generate order ID
    let counter = ORDER_COUNTER.load(deps.storage)?;
    let order_id = format!("bridge_order_{}", counter);
    ORDER_COUNTER.save(deps.storage, &(counter + 1))?;

    // Calculate timelock
    let timelock = env.block.time.plus_seconds(timelock_seconds);

    // Create bridge order
    let order = BridgeOrder {
        order_id: order_id.clone(),
        initiator: info.sender.clone(),
        source_chain_id: CHAIN_ID_COSMOS,
        target_chain_id,
        recipient: recipient.clone(),
        amount: payment.clone(),
        secret_hash: secret_hash.clone(),
        timelock,
        status: OrderStatus::Pending,
        created_at: env.block.time,
        completed_at: None,
        secret: None,
        ibc_packet_sequence: None,
    };

    BRIDGE_ORDERS.save(deps.storage, &order_id, &order)?;

    Ok(Response::new()
        .add_attribute("action", "create_bridge_order")
        .add_attribute("order_id", order_id)
        .add_attribute("initiator", info.sender)
        .add_attribute("target_chain_id", target_chain_id.to_string())
        .add_attribute("recipient", recipient)
        .add_attribute("amount", payment.amount.to_string())
        .add_attribute("denom", &payment.denom)
        .add_attribute("secret_hash", secret_hash)
        .add_attribute("timelock", timelock.to_string()))
}

pub fn execute_complete_bridge_order(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    order_id: String,
    secret: String,
) -> Result<Response, ContractError> {
    let mut order = BRIDGE_ORDERS.load(deps.storage, &order_id)?;

    // Check status
    match order.status {
        OrderStatus::Pending | OrderStatus::Active => {}
        OrderStatus::Completed => return Err(ContractError::OrderAlreadyCompleted {}),
        OrderStatus::Refunded => return Err(ContractError::OrderAlreadyRefunded {}),
        OrderStatus::Failed => return Err(ContractError::OrderAlreadyRefunded {}),
    }

    // Check timelock
    if env.block.time >= order.timelock {
        return Err(ContractError::TimelockExpired {});
    }

    // Verify secret
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    let computed_hash = format!("{:x}", hasher.finalize());
    
    if computed_hash != order.secret_hash {
        return Err(ContractError::InvalidSecret {});
    }

    // Update order status
    order.status = OrderStatus::Active;
    order.secret = Some(secret.clone());
    BRIDGE_ORDERS.save(deps.storage, &order_id, &order)?;

    let config = CONFIG.load(deps.storage)?;
    let target_chain = CHAIN_CONFIGS.load(deps.storage, order.target_chain_id)?;

    // Calculate fees
    let base_fee = order.amount.amount * Uint128::from(config.protocol_fee_bps) / Uint128::from(10000u64);
    let chain_fee = order.amount.amount * Uint128::from(target_chain.fee_multiplier) / Uint128::from(10000u64);
    let total_fee = base_fee + chain_fee;
    let transfer_amount = order.amount.amount - total_fee;

    // Create IBC transfer message
    let ibc_timeout = env.block.time.plus_seconds(config.ibc_timeout_seconds);
    
    let ibc_transfer_msg = IbcMsg::Transfer {
        channel_id: target_chain.ibc_channel.clone(),
        to_address: order.recipient.clone(),
        amount: Coin {
            denom: order.amount.denom.clone(),
            amount: transfer_amount,
        },
        timeout: IbcTimeout::with_timestamp(ibc_timeout),
    };

    // Store IBC transfer info
    let counter = ORDER_COUNTER.load(deps.storage)?;
    let packet_sequence = counter + 1; // This would be set by IBC in practice
    let ibc_transfer = IbcTransfer {
        order_id: order_id.clone(),
        packet_sequence,
        channel_id: target_chain.ibc_channel.clone(),
        sender: env.contract.address.clone(),
        receiver: order.recipient.clone(),
        amount: Coin {
            denom: order.amount.denom.clone(),
            amount: transfer_amount,
        },
        timeout_timestamp: ibc_timeout,
    };
    IBC_TRANSFERS.save(deps.storage, packet_sequence, &ibc_transfer)?;

    // Update order with packet sequence
    order.ibc_packet_sequence = Some(packet_sequence);
    BRIDGE_ORDERS.save(deps.storage, &order_id, &order)?;

    Ok(Response::new()
        .add_message(ibc_transfer_msg)
        .add_attribute("action", "complete_bridge_order")
        .add_attribute("order_id", order_id)
        .add_attribute("recipient", order.recipient)
        .add_attribute("amount", transfer_amount.to_string())
        .add_attribute("fee", total_fee.to_string())
        .add_attribute("secret", secret))
}

pub fn execute_refund_bridge_order(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    order_id: String,
) -> Result<Response, ContractError> {
    let mut order = BRIDGE_ORDERS.load(deps.storage, &order_id)?;

    // Only initiator can refund
    if info.sender != order.initiator {
        return Err(ContractError::Unauthorized {});
    }

    // Check status
    match order.status {
        OrderStatus::Pending | OrderStatus::Active => {}
        OrderStatus::Completed => return Err(ContractError::OrderAlreadyCompleted {}),
        OrderStatus::Refunded => return Err(ContractError::OrderAlreadyRefunded {}),
        OrderStatus::Failed => {}
    }

    // Check timelock
    if env.block.time < order.timelock {
        return Err(ContractError::TimelockNotExpired {});
    }

    // Update order status
    order.status = OrderStatus::Refunded;
    order.completed_at = Some(env.block.time);
    BRIDGE_ORDERS.save(deps.storage, &order_id, &order)?;

    // Create refund message
    let refund_msg = CosmosMsg::Bank(BankMsg::Send {
        to_address: order.initiator.to_string(),
        amount: vec![order.amount.clone()],
    });

    Ok(Response::new()
        .add_message(refund_msg)
        .add_attribute("action", "refund_bridge_order")
        .add_attribute("order_id", order_id)
        .add_attribute("initiator", order.initiator)
        .add_attribute("amount", order.amount.amount.to_string()))
}

pub fn execute_update_chain_config(
    deps: DepsMut,
    info: MessageInfo,
    chain_id: u32,
    config: ChainConfig,
) -> Result<Response, ContractError> {
    let contract_config = CONFIG.load(deps.storage)?;

    // Only owner can update
    if info.sender != contract_config.owner {
        return Err(ContractError::Unauthorized {});
    }

    CHAIN_CONFIGS.save(deps.storage, chain_id, &config)?;

    Ok(Response::new()
        .add_attribute("action", "update_chain_config")
        .add_attribute("chain_id", chain_id.to_string()))
}

pub fn execute_remove_chain_config(
    deps: DepsMut,
    info: MessageInfo,
    chain_id: u32,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // Only owner can remove
    if info.sender != config.owner {
        return Err(ContractError::Unauthorized {});
    }

    CHAIN_CONFIGS.remove(deps.storage, chain_id);

    Ok(Response::new()
        .add_attribute("action", "remove_chain_config")
        .add_attribute("chain_id", chain_id.to_string()))
}

pub fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    owner: Option<String>,
    protocol_fee_bps: Option<u64>,
    min_timelock_duration: Option<u64>,
    max_timelock_duration: Option<u64>,
    ibc_timeout_seconds: Option<u64>,
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

    if let Some(timeout) = ibc_timeout_seconds {
        config.ibc_timeout_seconds = timeout;
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
        QueryMsg::ChainConfig { chain_id } => to_json_binary(&query_chain_config(deps, chain_id)?),
        QueryMsg::AllChainConfigs { start_after, limit } => {
            to_json_binary(&query_all_chain_configs(deps, start_after, limit)?)
        }
        QueryMsg::BridgeOrder { order_id } => to_json_binary(&query_bridge_order(deps, order_id)?),
        QueryMsg::OrdersByInitiator { initiator, start_after, limit } => {
            to_json_binary(&query_orders_by_initiator(deps, initiator, start_after, limit)?)
        }
        QueryMsg::OrdersByStatus { status, start_after, limit } => {
            to_json_binary(&query_orders_by_status(deps, status, start_after, limit)?)
        }
        QueryMsg::OrdersByChain { chain_id, start_after, limit } => {
            to_json_binary(&query_orders_by_chain(deps, chain_id, start_after, limit)?)
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
        ibc_timeout_seconds: config.ibc_timeout_seconds,
    })
}

fn query_chain_config(deps: Deps, chain_id: u32) -> StdResult<ChainConfigResponse> {
    let config = CHAIN_CONFIGS.load(deps.storage, chain_id)?;
    Ok(ChainConfigResponse { config })
}

fn query_all_chain_configs(
    deps: Deps,
    start_after: Option<u32>,
    limit: Option<u32>,
) -> StdResult<ChainConfigsResponse> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.map(Bound::exclusive);
    
    let configs: Vec<(u32, ChainConfig)> = CHAIN_CONFIGS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit)
        .map(|item| item.map(|(k, v)| (k, v)))
        .collect::<StdResult<Vec<_>>>()?;

    Ok(ChainConfigsResponse { configs })
}

fn query_bridge_order(deps: Deps, order_id: String) -> StdResult<BridgeOrderResponse> {
    let order = BRIDGE_ORDERS.load(deps.storage, &order_id)?;
    Ok(BridgeOrderResponse { order })
}

fn query_orders_by_initiator(
    deps: Deps,
    initiator: String,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<BridgeOrdersResponse> {
    let initiator_addr = deps.api.addr_validate(&initiator)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.as_ref().map(|s| Bound::exclusive(s.as_str()));
    
    let orders: Vec<BridgeOrder> = BRIDGE_ORDERS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit)
        .filter_map(|item| {
            item.ok().and_then(|(_, order)| {
                if order.initiator == initiator_addr {
                    Some(order)
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(BridgeOrdersResponse { orders })
}

fn query_orders_by_status(
    deps: Deps,
    status: OrderStatus,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<BridgeOrdersResponse> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.as_ref().map(|s| Bound::exclusive(s.as_str()));
    
    let orders: Vec<BridgeOrder> = BRIDGE_ORDERS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit)
        .filter_map(|item| {
            item.ok().and_then(|(_, order)| {
                if order.status == status {
                    Some(order)
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(BridgeOrdersResponse { orders })
}

fn query_orders_by_chain(
    deps: Deps,
    chain_id: u32,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<BridgeOrdersResponse> {
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.as_ref().map(|s| Bound::exclusive(s.as_str()));
    
    let orders: Vec<BridgeOrder> = BRIDGE_ORDERS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit)
        .filter_map(|item| {
            item.ok().and_then(|(_, order)| {
                if order.target_chain_id == chain_id || order.source_chain_id == chain_id {
                    Some(order)
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(BridgeOrdersResponse { orders })
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

// IBC entry points
pub use crate::ibc::{
    ibc_channel_close, ibc_channel_connect, ibc_channel_open, ibc_packet_ack,
    ibc_packet_receive, ibc_packet_timeout,
};