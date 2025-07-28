use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Bridge order not found")]
    OrderNotFound {},

    #[error("Bridge order already exists")]
    OrderAlreadyExists {},

    #[error("Invalid secret")]
    InvalidSecret {},

    #[error("Invalid secret hash")]
    InvalidSecretHash {},

    #[error("Order already completed")]
    OrderAlreadyCompleted {},

    #[error("Order already refunded")]
    OrderAlreadyRefunded {},

    #[error("Timelock not expired")]
    TimelockNotExpired {},

    #[error("Timelock already expired")]
    TimelockExpired {},

    #[error("Invalid timelock: must be between {min} and {max} seconds")]
    InvalidTimelock { min: u64, max: u64 },

    #[error("Invalid amount")]
    InvalidAmount {},

    #[error("Insufficient funds")]
    InsufficientFunds {},

    #[error("Invalid chain ID")]
    InvalidChainId {},

    #[error("Chain not supported")]
    ChainNotSupported {},

    #[error("Invalid IBC channel")]
    InvalidIbcChannel {},

    #[error("IBC transfer failed")]
    IbcTransferFailed {},

    #[error("Invalid recipient address")]
    InvalidRecipientAddress {},
}