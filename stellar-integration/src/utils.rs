use soroban_sdk::{BytesN, Env, Bytes};

/// Verify that a secret matches the given hash
pub fn verify_secret(env: &Env, secret: &BytesN<32>, hash: &BytesN<32>) -> bool {
    // Convert BytesN<32> to Bytes for keccak256
    let secret_bytes = Bytes::from(secret.clone());
    let computed_hash = env.crypto().keccak256(&secret_bytes);
    let computed_hash_bytes: BytesN<32> = computed_hash.into();
    computed_hash_bytes == *hash
}

/// Generate a hash from a secret
pub fn hash_secret(env: &Env, secret: &BytesN<32>) -> BytesN<32> {
    // Convert BytesN<32> to Bytes for keccak256
    let secret_bytes = Bytes::from(secret.clone());
    let hash = env.crypto().keccak256(&secret_bytes);
    hash.into()
}

/// Get current ledger timestamp
pub fn get_current_timestamp(env: &Env) -> u64 {
    env.ledger().timestamp()
}

/// Check if a timelock has expired
pub fn is_timelock_expired(env: &Env, timelock: u64) -> bool {
    get_current_timestamp(env) >= timelock
}

/// Validate timelock duration
pub fn validate_timelock_duration(env: &Env, timelock: u64) -> bool {
    let current_time = get_current_timestamp(env);
    let min_time = current_time + crate::types::MIN_TIMELOCK_DURATION;
    let max_time = current_time + crate::types::MAX_TIMELOCK_DURATION;
    
    timelock >= min_time && timelock <= max_time
}

/// Calculate protocol fee
pub fn calculate_protocol_fee(amount: i128, fee_rate: u32) -> i128 {
    (amount * fee_rate as i128) / 10000
}

/// Validate amount (must be positive)
pub fn validate_amount(amount: i128) -> bool {
    amount > 0
}

/// Validate secret hash length
pub fn validate_secret_hash(_hash: &BytesN<32>) -> bool {
    // BytesN<32> already enforces the length, so this is always true
    true
}

/// Generate storage key for swap
pub fn swap_storage_key(_swap_id: u64) -> BytesN<32> {
    let env = Env::default();
    let key = BytesN::from_array(&env, &[0u8; 32]);
    // Simple implementation - in practice, you'd want more sophisticated key generation
    key
}

/// Generate storage key for bridge order
pub fn bridge_order_storage_key(_order_id: u64) -> BytesN<32> {
    let env = Env::default();
    let key = BytesN::from_array(&env, &[0u8; 32]);
    // Simple implementation - in practice, you'd want more sophisticated key generation
    key
}

/// Check if chain is supported
pub fn is_chain_supported(chain_id: u32) -> bool {
    matches!(chain_id, 
        crate::types::CHAIN_STELLAR |
        crate::types::CHAIN_ETHEREUM |
        crate::types::CHAIN_BITCOIN |
        crate::types::CHAIN_APTOS |
        crate::types::CHAIN_SUI |
        crate::types::CHAIN_POLYGON |
        crate::types::CHAIN_ARBITRUM |
        crate::types::CHAIN_OPTIMISM |
        crate::types::CHAIN_BSC |
        crate::types::CHAIN_AVALANCHE
    )
} 