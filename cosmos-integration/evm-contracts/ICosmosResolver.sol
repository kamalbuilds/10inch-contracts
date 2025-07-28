// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title ICosmosResolver
 * @dev Interface for EVM-side resolver that coordinates with Cosmos chain
 * @notice Handles cross-chain atomic swaps between EVM and Cosmos chains
 */
interface ICosmosResolver {
    // ============ Events ============
    
    event OrderCreated(
        uint256 indexed orderId,
        address indexed initiator,
        address indexed resolver,
        uint32 dstChainId,
        string dstRecipient,
        bytes32 secretHash,
        uint256 amount,
        uint256 timelock
    );
    
    event DstEscrowDeployed(
        uint256 indexed orderId,
        address resolver,
        string cosmosOrderId,
        uint256 amount,
        bytes32 secretHash
    );
    
    event Withdrawn(
        uint256 indexed orderId,
        address indexed withdrawer,
        uint256 amount,
        bytes32 secret
    );
    
    event Cancelled(
        uint256 indexed orderId,
        address indexed canceller,
        uint256 amount
    );

    // ============ Structs ============
    
    struct Order {
        uint256 orderId;
        address initiator;
        address resolver;
        uint32 srcChainId;
        uint32 dstChainId;
        address token;
        uint256 amount;
        string dstRecipient;
        bytes32 secretHash;
        uint256 timelock;
        uint256 safetyDeposit;
        bool srcDeployed;
        bool dstDeployed;
        bool completed;
        bool cancelled;
    }

    struct CosmosEscrowImmutables {
        bytes32 orderHash;
        uint32 srcChainId;
        uint32 dstChainId;
        string srcToken;
        string dstToken;
        uint256 srcAmount;
        uint256 dstAmount;
        string resolver;
        string beneficiary;
        bytes32 secretHash;
        uint256 finalityTimestamp;
        uint256 resolverTimestamp;
        uint256 beneficiaryTimestamp;
        uint256 safetyDeposit;
    }

    // ============ Core Functions ============
    
    /**
     * @dev Create a cross-chain order from EVM to Cosmos
     * @param dstChainId Destination chain ID (1 for Cosmos)
     * @param dstRecipient Recipient address on Cosmos
     * @param token Token address (address(0) for native)
     * @param amount Amount to swap
     * @param secretHash Hash of the secret
     * @param timelock Expiration timestamp
     * @return orderId The created order ID
     */
    function createOrder(
        uint32 dstChainId,
        string calldata dstRecipient,
        address token,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    ) external payable returns (uint256 orderId);

    /**
     * @dev Resolver fills the order on source chain
     * @param orderId Order ID to fill
     * @param safetyDeposit Safety deposit amount
     */
    function fillOrder(
        uint256 orderId,
        uint256 safetyDeposit
    ) external payable;

    /**
     * @dev Deploy destination escrow (called after Cosmos confirmation)
     * @param orderId Order ID
     * @param cosmosOrderId Order ID from Cosmos chain
     * @param immutables Escrow parameters from Cosmos
     */
    function deployDstEscrow(
        uint256 orderId,
        string calldata cosmosOrderId,
        CosmosEscrowImmutables calldata immutables
    ) external;

    /**
     * @dev Withdraw funds by revealing the secret
     * @param orderId Order ID
     * @param secret The secret that matches the hash
     */
    function withdraw(
        uint256 orderId,
        bytes32 secret
    ) external;

    /**
     * @dev Cancel expired order
     * @param orderId Order ID
     */
    function cancel(uint256 orderId) external;

    // ============ View Functions ============
    
    function getOrder(uint256 orderId) external view returns (Order memory);
    
    function getOrderBySecretHash(bytes32 secretHash) external view returns (uint256);
    
    function canWithdraw(uint256 orderId, address user) external view returns (bool);
    
    function canCancel(uint256 orderId) external view returns (bool);
    
    function verifySecret(bytes32 secret, bytes32 secretHash) external pure returns (bool);
}