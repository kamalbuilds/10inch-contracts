use cosmwasm_std::{
    from_json, to_json_binary, Binary, DepsMut, Env, IbcBasicResponse, IbcChannel,
    IbcChannelCloseMsg, IbcChannelConnectMsg, IbcChannelOpenMsg, IbcChannelOpenResponse,
    IbcOrder, IbcPacketAckMsg, IbcPacketReceiveMsg, IbcPacketTimeoutMsg, IbcReceiveResponse,
    IbcTimeout, Never, Response, StdResult, Timestamp,
};

use crate::error::ContractError;
use crate::msg::{IbcAcknowledgement, IbcExecuteMsg};
use crate::state::{OrderStatus, BRIDGE_ORDERS, IBC_TRANSFERS};

const IBC_VERSION: &str = "fusion-bridge-v1";

pub fn ibc_channel_open(
    _deps: DepsMut,
    _env: Env,
    msg: IbcChannelOpenMsg,
) -> Result<IbcChannelOpenResponse, ContractError> {
    validate_order_and_version(msg.channel(), msg.counterparty_version())?;
    Ok(None)
}

pub fn ibc_channel_connect(
    _deps: DepsMut,
    _env: Env,
    msg: IbcChannelConnectMsg,
) -> Result<IbcBasicResponse, ContractError> {
    validate_order_and_version(msg.channel(), msg.counterparty_version())?;
    
    Ok(IbcBasicResponse::new()
        .add_attribute("action", "ibc_channel_connect")
        .add_attribute("channel_id", &msg.channel().endpoint.channel_id))
}

pub fn ibc_channel_close(
    _deps: DepsMut,
    _env: Env,
    msg: IbcChannelCloseMsg,
) -> Result<IbcBasicResponse, ContractError> {
    Ok(IbcBasicResponse::new()
        .add_attribute("action", "ibc_channel_close")
        .add_attribute("channel_id", msg.channel().endpoint.channel_id.clone()))
}

pub fn ibc_packet_receive(
    deps: DepsMut,
    env: Env,
    msg: IbcPacketReceiveMsg,
) -> Result<IbcReceiveResponse, Never> {
    let packet = msg.packet;
    
    let res: Result<IbcExecuteMsg, _> = from_json(&packet.data);
    match res {
        Ok(ibc_msg) => {
            let acknowledgement = match process_ibc_message(deps, env, ibc_msg) {
                Ok(_) => IbcAcknowledgement {
                    success: true,
                    error: None,
                },
                Err(err) => IbcAcknowledgement {
                    success: false,
                    error: Some(err.to_string()),
                },
            };
            
            Ok(IbcReceiveResponse::new()
                .set_ack(to_json_binary(&acknowledgement).unwrap())
                .add_attribute("action", "ibc_packet_receive"))
        }
        Err(err) => {
            let acknowledgement = IbcAcknowledgement {
                success: false,
                error: Some(format!("Failed to parse IBC message: {}", err)),
            };
            
            Ok(IbcReceiveResponse::new()
                .set_ack(to_json_binary(&acknowledgement).unwrap())
                .add_attribute("action", "ibc_packet_receive")
                .add_attribute("error", err.to_string()))
        }
    }
}

pub fn ibc_packet_ack(
    deps: DepsMut,
    _env: Env,
    msg: IbcPacketAckMsg,
) -> Result<IbcBasicResponse, ContractError> {
    let ack: IbcAcknowledgement = from_json(&msg.acknowledgement.data)?;
    let sequence = msg.original_packet.sequence;
    
    // Update transfer status based on acknowledgement
    if let Some(transfer) = IBC_TRANSFERS.may_load(deps.storage, sequence)? {
        if let Ok(mut order) = BRIDGE_ORDERS.load(deps.storage, &transfer.order_id) {
            if ack.success {
                order.status = OrderStatus::Completed;
            } else {
                order.status = OrderStatus::Failed;
            }
            BRIDGE_ORDERS.save(deps.storage, &transfer.order_id, &order)?;
        }
        
        // Remove the transfer record
        IBC_TRANSFERS.remove(deps.storage, sequence);
    }
    
    Ok(IbcBasicResponse::new()
        .add_attribute("action", "ibc_packet_ack")
        .add_attribute("sequence", sequence.to_string())
        .add_attribute("success", ack.success.to_string()))
}

pub fn ibc_packet_timeout(
    deps: DepsMut,
    _env: Env,
    msg: IbcPacketTimeoutMsg,
) -> Result<IbcBasicResponse, ContractError> {
    let sequence = msg.packet.sequence;
    
    // Handle timeout - mark order as failed
    if let Some(transfer) = IBC_TRANSFERS.may_load(deps.storage, sequence)? {
        if let Ok(mut order) = BRIDGE_ORDERS.load(deps.storage, &transfer.order_id) {
            order.status = OrderStatus::Failed;
            BRIDGE_ORDERS.save(deps.storage, &transfer.order_id, &order)?;
        }
        
        // Remove the transfer record
        IBC_TRANSFERS.remove(deps.storage, sequence);
    }
    
    Ok(IbcBasicResponse::new()
        .add_attribute("action", "ibc_packet_timeout")
        .add_attribute("sequence", sequence.to_string()))
}

fn validate_order_and_version(
    channel: &IbcChannel,
    counterparty_version: Option<&str>,
) -> Result<(), ContractError> {
    if channel.order != IbcOrder::Ordered {
        return Err(ContractError::InvalidIbcChannel {});
    }
    
    if channel.version != IBC_VERSION {
        return Err(ContractError::InvalidIbcChannel {});
    }
    
    if let Some(version) = counterparty_version {
        if version != IBC_VERSION {
            return Err(ContractError::InvalidIbcChannel {});
        }
    }
    
    Ok(())
}

fn process_ibc_message(
    deps: DepsMut,
    env: Env,
    msg: IbcExecuteMsg,
) -> Result<Response, ContractError> {
    // Process cross-chain order completion
    let mut order = BRIDGE_ORDERS.load(deps.storage, &msg.order_id)?;
    
    // Verify the secret
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(msg.secret.as_bytes());
    let computed_hash = format!("{:x}", hasher.finalize());
    
    if computed_hash != order.secret_hash {
        return Err(ContractError::InvalidSecret {});
    }
    
    // Update order status
    order.status = OrderStatus::Completed;
    order.completed_at = Some(env.block.time);
    order.secret = Some(msg.secret);
    BRIDGE_ORDERS.save(deps.storage, &msg.order_id, &order)?;
    
    Ok(Response::new()
        .add_attribute("action", "process_ibc_order")
        .add_attribute("order_id", msg.order_id))
}