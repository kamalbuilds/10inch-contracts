use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Order not found")]
    OrderNotFound {},

    #[error("Order already exists")]
    OrderAlreadyExists {},

    #[error("Invalid secret")]
    InvalidSecret {},

    #[error("Invalid secret hash")]
    InvalidSecretHash {},

    #[error("Order already completed")]
    OrderAlreadyCompleted {},

    #[error("Order already cancelled")]
    OrderAlreadyCancelled {},

    #[error("Timelock not expired")]
    TimelockNotExpired {},

    #[error("Timelock already expired")]
    TimelockExpired {},

    #[error("Invalid amount")]
    InvalidAmount {},

    #[error("Insufficient funds")]
    InsufficientFunds {},

    #[error("Insufficient safety deposit")]
    InsufficientSafetyDeposit {},

    #[error("Source not deployed")]
    SourceNotDeployed {},

    #[error("Destination already deployed")]
    DestinationAlreadyDeployed {},

    #[error("Not resolver")]
    NotResolver {},

    #[error("Invalid chain ID")]
    InvalidChainId {},

    #[error("Invalid timelock: must be greater than current time")]
    InvalidTimelock {},
}