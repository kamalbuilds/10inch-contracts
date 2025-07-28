use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Coin, CosmosMsg, Deps, DepsMut, Env, MessageInfo,
    Order, Response, StdResult, Timestamp, Uint128, BankMsg, Attribute,
};
use cw2::set_contract_version;
use cw_storage_plus::Bound;
use sha2::{Sha256, Digest};

use crate::error::ContractError;
use crate::msg::{
    CanCancelResponse, CanWithdrawResponse, ConfigResponse, EscrowImmutablesResponse,
    ExecuteMsg, InstantiateMsg, MigrateMsg, OrderResponse, OrdersResponse, QueryMsg,
};
use crate::state::{
    Config, EscrowImmutables, ResolverOrder, CONFIG, ORDERS, ORDER_COUNTER,
    SECRET_HASH_TO_ORDER_ID, CHAIN_ID_COSMOS,
};

const CONTRACT_NAME: &str = "crates.io:cosmos-resolver";
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
        atomic_swap_contract: deps.api.addr_validate(&msg.atomic_swap_contract)?,
        bridge_contract: deps.api.addr_validate(&msg.bridge_contract)?,
    };

    CONFIG.save(deps.storage, &config)?;
    ORDER_COUNTER.save(deps.storage, &0u64)?;

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
        ExecuteMsg::DeploySrc {
            initiator,
            dst_chain_id,
            dst_recipient,
            dst_token,
            src_amount,
            dst_amount,
            secret_hash,
            safety_deposit,
            timelock,
        } => execute_deploy_src(
            deps,
            env,
            info,
            initiator,
            dst_chain_id,
            dst_recipient,
            dst_token,
            src_amount,
            dst_amount,
            secret_hash,
            safety_deposit,
            timelock,
        ),
        ExecuteMsg::DeployDst { order_id } => execute_deploy_dst(deps, env, info, order_id),
        ExecuteMsg::Withdraw { order_id, secret, is_source_chain } => {
            execute_withdraw(deps, env, info, order_id, secret, is_source_chain)
        }
        ExecuteMsg::Cancel { order_id } => execute_cancel(deps, env, info, order_id),
        ExecuteMsg::UpdateConfig {
            owner,
            atomic_swap_contract,
            bridge_contract,
        } => execute_update_config(deps, info, owner, atomic_swap_contract, bridge_contract),
    }
}

pub fn execute_deploy_src(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    initiator: String,
    dst_chain_id: u32,
    dst_recipient: String,
    dst_token: String,
    src_amount: Coin,
    dst_amount: String,
    secret_hash: String,
    safety_deposit: Coin,
    timelock_seconds: u64,
) -> Result<Response, ContractError> {
    // Validate inputs
    if src_amount.amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }
    
    if safety_deposit.amount.is_zero() {
        return Err(ContractError::InsufficientSafetyDeposit {});
    }

    if secret_hash.len() != 64 || !secret_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ContractError::InvalidSecretHash {});
    }

    let current_time = env.block.time;
    let timelock = current_time.plus_seconds(timelock_seconds);
    
    if timelock <= current_time {
        return Err(ContractError::InvalidTimelock {});
    }

    // Validate payment
    let mut total_required = src_amount.amount;
    if src_amount.denom == safety_deposit.denom {
        total_required = total_required + safety_deposit.amount;
    }

    let payment = info.funds.iter().find(|c| c.denom == src_amount.denom);
    if payment.map_or(true, |c| c.amount < total_required) {
        return Err(ContractError::InsufficientFunds {});
    }

    // Validate separate safety deposit if different denom
    if src_amount.denom != safety_deposit.denom {
        let safety_payment = info.funds.iter().find(|c| c.denom == safety_deposit.denom);
        if safety_payment.map_or(true, |c| c.amount < safety_deposit.amount) {
            return Err(ContractError::InsufficientSafetyDeposit {});
        }
    }

    // Generate order ID
    let order_id = ORDER_COUNTER.load(deps.storage)? + 1;
    ORDER_COUNTER.save(deps.storage, &order_id)?;

    // Create order
    let order = ResolverOrder {
        order_id,
        initiator: deps.api.addr_validate(&initiator)?,
        resolver: info.sender.clone(),
        src_chain_id: CHAIN_ID_COSMOS,
        dst_chain_id,
        src_amount: src_amount.clone(),
        dst_amount: dst_amount.clone(),
        dst_token: dst_token.clone(),
        dst_recipient: dst_recipient.clone(),
        safety_deposit: safety_deposit.clone(),
        secret_hash: secret_hash.clone(),
        src_timelock: timelock,
        dst_timelock: timelock.plus_seconds(3600), // 1 hour extra for destination
        src_deployed: true,
        dst_deployed: false,
        completed: false,
        cancelled: false,
        secret: None,
    };

    ORDERS.save(deps.storage, order_id, &order)?;
    SECRET_HASH_TO_ORDER_ID.save(deps.storage, &secret_hash, &order_id)?;

    Ok(Response::new()
        .add_attribute("action", "deploy_src")
        .add_attribute("order_id", order_id.to_string())
        .add_attribute("resolver", info.sender)
        .add_attribute("initiator", initiator)
        .add_attribute("secret_hash", secret_hash)
        .add_attribute("src_amount", src_amount.amount.to_string())
        .add_attribute("safety_deposit", safety_deposit.amount.to_string())
        .add_attribute("timelock", timelock.to_string()))
}

pub fn execute_deploy_dst(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    order_id: u64,
) -> Result<Response, ContractError> {
    let mut order = ORDERS.load(deps.storage, order_id)?;

    // Validations
    if info.sender != order.resolver {
        return Err(ContractError::NotResolver {});
    }

    if !order.src_deployed {
        return Err(ContractError::SourceNotDeployed {});
    }

    if order.dst_deployed {
        return Err(ContractError::DestinationAlreadyDeployed {});
    }

    // Update order
    order.dst_deployed = true;
    ORDERS.save(deps.storage, order_id, &order)?;

    // In a real implementation, this would trigger an IBC message or
    // off-chain relayer to deploy on the destination chain
    
    Ok(Response::new()
        .add_attribute("action", "deploy_dst")
        .add_attribute("order_id", order_id.to_string())
        .add_attribute("dst_chain_id", order.dst_chain_id.to_string())
        .add_attribute("dst_recipient", order.dst_recipient)
        .add_attribute("dst_amount", order.dst_amount))
}

pub fn execute_withdraw(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    order_id: u64,
    secret: String,
    is_source_chain: bool,
) -> Result<Response, ContractError> {
    let mut order = ORDERS.load(deps.storage, order_id)?;

    // Validate order state
    if order.completed {
        return Err(ContractError::OrderAlreadyCompleted {});
    }

    if order.cancelled {
        return Err(ContractError::OrderAlreadyCancelled {});
    }

    // Verify secret
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    let computed_hash = format!("{:x}", hasher.finalize());
    
    if computed_hash != order.secret_hash {
        return Err(ContractError::InvalidSecret {});
    }

    let mut messages = vec![];
    let mut attributes = vec![
        Attribute::new("action", "withdraw"),
        Attribute::new("order_id", order_id.to_string()),
        Attribute::new("secret", &secret),
    ];

    if is_source_chain {
        // Resolver withdraws from source after secret revealed
        if info.sender != order.resolver {
            return Err(ContractError::NotResolver {});
        }

        if env.block.time > order.src_timelock {
            return Err(ContractError::TimelockExpired {});
        }

        // Transfer source funds to resolver
        messages.push(CosmosMsg::Bank(BankMsg::Send {
            to_address: order.resolver.to_string(),
            amount: vec![order.src_amount.clone()],
        }));

        // Return safety deposit
        messages.push(CosmosMsg::Bank(BankMsg::Send {
            to_address: order.resolver.to_string(),
            amount: vec![order.safety_deposit.clone()],
        }));

        attributes.push(Attribute::new("withdrawer", order.resolver.to_string()));
        attributes.push(Attribute::new("amount", order.src_amount.amount.to_string()));

    } else {
        // User withdraws from destination
        if info.sender != order.initiator {
            return Err(ContractError::Unauthorized {});
        }

        // Mark as completed
        order.completed = true;
        order.secret = Some(secret.clone());
        
        attributes.push(Attribute::new("withdrawer", order.initiator.to_string()));
    }

    ORDERS.save(deps.storage, order_id, &order)?;

    Ok(Response::new()
        .add_messages(messages)
        .add_attributes(attributes))
}

pub fn execute_cancel(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    order_id: u64,
) -> Result<Response, ContractError> {
    let mut order = ORDERS.load(deps.storage, order_id)?;

    // Validate order state
    if order.completed {
        return Err(ContractError::OrderAlreadyCompleted {});
    }

    if order.cancelled {
        return Err(ContractError::OrderAlreadyCancelled {});
    }

    // Check if timelock expired
    if env.block.time <= order.src_timelock {
        return Err(ContractError::TimelockNotExpired {});
    }

    // Only initiator or resolver can cancel after expiry
    if info.sender != order.initiator && info.sender != order.resolver {
        return Err(ContractError::Unauthorized {});
    }

    order.cancelled = true;
    ORDERS.save(deps.storage, order_id, &order)?;

    let mut messages = vec![];

    // Refund source amount to initiator
    if order.src_deployed {
        messages.push(CosmosMsg::Bank(BankMsg::Send {
            to_address: order.initiator.to_string(),
            amount: vec![order.src_amount.clone()],
        }));

        // Return safety deposit to resolver
        messages.push(CosmosMsg::Bank(BankMsg::Send {
            to_address: order.resolver.to_string(),
            amount: vec![order.safety_deposit.clone()],
        }));
    }

    Ok(Response::new()
        .add_messages(messages)
        .add_attribute("action", "cancel")
        .add_attribute("order_id", order_id.to_string())
        .add_attribute("canceller", info.sender))
}

pub fn execute_update_config(
    deps: DepsMut,
    info: MessageInfo,
    owner: Option<String>,
    atomic_swap_contract: Option<String>,
    bridge_contract: Option<String>,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    // Only owner can update
    if info.sender != config.owner {
        return Err(ContractError::Unauthorized {});
    }

    if let Some(owner) = owner {
        config.owner = deps.api.addr_validate(&owner)?;
    }

    if let Some(atomic_swap) = atomic_swap_contract {
        config.atomic_swap_contract = deps.api.addr_validate(&atomic_swap)?;
    }

    if let Some(bridge) = bridge_contract {
        config.bridge_contract = deps.api.addr_validate(&bridge)?;
    }

    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new().add_attribute("action", "update_config"))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::Order { order_id } => to_json_binary(&query_order(deps, order_id)?),
        QueryMsg::OrderBySecretHash { secret_hash } => {
            to_json_binary(&query_order_by_secret_hash(deps, secret_hash)?)
        }
        QueryMsg::OrdersByResolver { resolver, start_after, limit } => {
            to_json_binary(&query_orders_by_resolver(deps, resolver, start_after, limit)?)
        }
        QueryMsg::OrdersByInitiator { initiator, start_after, limit } => {
            to_json_binary(&query_orders_by_initiator(deps, initiator, start_after, limit)?)
        }
        QueryMsg::CanWithdraw { order_id, user } => {
            to_json_binary(&query_can_withdraw(deps, env, order_id, user)?)
        }
        QueryMsg::CanCancel { order_id } => {
            to_json_binary(&query_can_cancel(deps, env, order_id)?)
        }
        QueryMsg::GetEscrowImmutables { order_id } => {
            to_json_binary(&query_escrow_immutables(deps, order_id)?)
        }
    }
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        owner: config.owner.to_string(),
        atomic_swap_contract: config.atomic_swap_contract.to_string(),
        bridge_contract: config.bridge_contract.to_string(),
    })
}

fn query_order(deps: Deps, order_id: u64) -> StdResult<OrderResponse> {
    let order = ORDERS.load(deps.storage, order_id)?;
    Ok(OrderResponse { order })
}

fn query_order_by_secret_hash(deps: Deps, secret_hash: String) -> StdResult<u64> {
    SECRET_HASH_TO_ORDER_ID.load(deps.storage, &secret_hash)
}

fn query_orders_by_resolver(
    deps: Deps,
    resolver: String,
    start_after: Option<u64>,
    limit: Option<u32>,
) -> StdResult<OrdersResponse> {
    let resolver_addr = deps.api.addr_validate(&resolver)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.map(|id| Bound::exclusive(id));
    
    let orders: Vec<ResolverOrder> = ORDERS
        .range(deps.storage, start, None, Order::Ascending)
        .take(limit)
        .filter_map(|item| {
            item.ok().and_then(|(_, order)| {
                if order.resolver == resolver_addr {
                    Some(order)
                } else {
                    None
                }
            })
        })
        .collect();

    Ok(OrdersResponse { orders })
}

fn query_orders_by_initiator(
    deps: Deps,
    initiator: String,
    start_after: Option<u64>,
    limit: Option<u32>,
) -> StdResult<OrdersResponse> {
    let initiator_addr = deps.api.addr_validate(&initiator)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize;
    
    let start = start_after.map(|id| Bound::exclusive(id));
    
    let orders: Vec<ResolverOrder> = ORDERS
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

    Ok(OrdersResponse { orders })
}

fn query_can_withdraw(
    deps: Deps,
    env: Env,
    order_id: u64,
    user: String,
) -> StdResult<CanWithdrawResponse> {
    let order = ORDERS.load(deps.storage, order_id)?;
    let user_addr = deps.api.addr_validate(&user)?;

    if order.completed {
        return Ok(CanWithdrawResponse {
            can_withdraw: false,
            reason: Some("Order already completed".to_string()),
        });
    }

    if order.cancelled {
        return Ok(CanWithdrawResponse {
            can_withdraw: false,
            reason: Some("Order cancelled".to_string()),
        });
    }

    // Resolver can withdraw from source if within timelock
    if user_addr == order.resolver && env.block.time <= order.src_timelock {
        return Ok(CanWithdrawResponse {
            can_withdraw: true,
            reason: None,
        });
    }

    // Initiator can withdraw from destination if deployed
    if user_addr == order.initiator && order.dst_deployed {
        return Ok(CanWithdrawResponse {
            can_withdraw: true,
            reason: None,
        });
    }

    Ok(CanWithdrawResponse {
        can_withdraw: false,
        reason: Some("Not authorized or conditions not met".to_string()),
    })
}

fn query_can_cancel(deps: Deps, env: Env, order_id: u64) -> StdResult<CanCancelResponse> {
    let order = ORDERS.load(deps.storage, order_id)?;

    if order.completed {
        return Ok(CanCancelResponse {
            can_cancel: false,
            reason: Some("Order already completed".to_string()),
        });
    }

    if order.cancelled {
        return Ok(CanCancelResponse {
            can_cancel: false,
            reason: Some("Order already cancelled".to_string()),
        });
    }

    if env.block.time <= order.src_timelock {
        return Ok(CanCancelResponse {
            can_cancel: false,
            reason: Some("Timelock not expired".to_string()),
        });
    }

    Ok(CanCancelResponse {
        can_cancel: true,
        reason: None,
    })
}

fn query_escrow_immutables(deps: Deps, order_id: u64) -> StdResult<EscrowImmutablesResponse> {
    let order = ORDERS.load(deps.storage, order_id)?;

    // Create immutables structure for cross-chain coordination
    let immutables = EscrowImmutables {
        order_hash: format!("0x{:064x}", order_id), // Simplified order hash
        src_chain_id: order.src_chain_id,
        dst_chain_id: order.dst_chain_id,
        src_token: order.src_amount.denom.clone(),
        dst_token: order.dst_token.clone(),
        src_amount: order.src_amount.amount.to_string(),
        dst_amount: order.dst_amount.clone(),
        resolver: order.resolver.to_string(),
        beneficiary: order.dst_recipient.clone(),
        secret_hash: order.secret_hash.clone(),
        finality_timestamp: order.src_timelock.seconds() - 7200, // 2 hours before main timelock
        resolver_timestamp: order.src_timelock.seconds(),
        beneficiary_timestamp: order.dst_timelock.seconds(),
        safety_deposit: order.safety_deposit.amount.to_string(),
    };

    Ok(EscrowImmutablesResponse { immutables })
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn migrate(_deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    Ok(Response::new())
}