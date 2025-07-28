use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Swap not found")]
    SwapNotFound {},

    #[error("Swap already exists")]
    SwapAlreadyExists {},

    #[error("Invalid secret")]
    InvalidSecret {},

    #[error("Invalid secret hash")]
    InvalidSecretHash {},

    #[error("Swap already completed")]
    SwapAlreadyCompleted {},

    #[error("Swap already refunded")]
    SwapAlreadyRefunded {},

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
}