// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title TronAtomicSwap
 * @dev Hash Time Locked Contract (HTLC) for atomic swaps on Tron
 * @author kamal
 */

import "./interfaces/ITRC20.sol";
import "./libraries/SafeMath.sol";
import "./libraries/ReentrancyGuard.sol";

contract TronAtomicSwap is ReentrancyGuard {
    using SafeMath for uint256;

    // ============ Events ============

    event SwapCreated(
        uint256 indexed swapId,
        address indexed initiator,
        address indexed recipient,
        uint256 amount,
        address tokenAddress,
        bytes32 secretHash,
        uint256 timelock,
        uint256 createdAt
    );

    event SwapCompleted(
        uint256 indexed swapId,
        address indexed recipient,
        uint256 amount,
        bytes32 secret,
        uint256 completedAt
    );

    event SwapRefunded(
        uint256 indexed swapId,
        address indexed initiator,
        uint256 amount,
        uint256 refundedAt
    );

    event BridgeOrderCreated(
        uint256 indexed orderId,
        address indexed initiator,
        uint256 destinationChainId,
        string recipient,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock,
        uint256 createdAt
    );

    event BridgeOrderCompleted(
        uint256 indexed orderId,
        bytes32 secret,
        uint256 completedAt
    );

    event BridgeOrderCancelled(
        uint256 indexed orderId,
        uint256 cancelledAt
    );

    // ============ Enums ============

    enum SwapStatus { Active, Completed, Refunded, Expired }
    enum BridgeStatus { Pending, Completed, Cancelled, Expired }

    // ============ Structs ============

    struct SwapState {
        uint256 id;
        address initiator;
        address recipient;
        uint256 amount;
        address tokenAddress;
        bytes32 secretHash;
        uint256 timelock;
        SwapStatus status;
        uint256 createdAt;
        uint256 completedAt;
    }

    struct BridgeOrder {
        uint256 id;
        address initiator;
        uint256 sourceChainId;
        uint256 destinationChainId;
        string recipient;
        uint256 amount;
        uint256 minDestinationAmount;
        address tokenAddress;
        bytes32 secretHash;
        uint256 timelock;
        BridgeStatus status;
        uint256 createdAt;
        uint256 completedAt;
        string sourceTxHash;
        string destinationTxHash;
    }

    // ============ Constants ============

    uint256 public constant MIN_TIMELOCK_DURATION = 1 hours;
    uint256 public constant MAX_TIMELOCK_DURATION = 24 hours;
    uint256 public constant PROTOCOL_FEE_RATE = 50; // 0.5% in basis points
    uint256 public constant MAX_FEE_RATE = 500; // 5% maximum
    uint256 public constant CHAIN_ID_TRON = 1;
    uint256 public constant CHAIN_ID_ETHEREUM = 2;
    uint256 public constant CHAIN_ID_BITCOIN = 3;
    uint256 public constant CHAIN_ID_STELLAR = 4;
    uint256 public constant CHAIN_ID_APTOS = 5;
    uint256 public constant CHAIN_ID_SUI = 6;
    uint256 public constant CHAIN_ID_POLYGON = 7;
    uint256 public constant CHAIN_ID_ARBITRUM = 8;
    uint256 public constant CHAIN_ID_OPTIMISM = 9;
    uint256 public constant CHAIN_ID_BSC = 10;

    // ============ Storage ============

    address public admin;
    uint256 public protocolFeeRate;
    uint256 public swapCounter;
    uint256 public bridgeCounter;
    bool public paused;

    mapping(uint256 => SwapState) public swaps;
    mapping(uint256 => BridgeOrder) public bridgeOrders;
    mapping(uint256 => bool) public supportedChains;
    mapping(address => bool) public supportedTokens;

    // ============ Modifiers ============

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    modifier notPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier validSwap(uint256 swapId) {
        require(swaps[swapId].id != 0, "Swap not found");
        _;
    }

    modifier validBridgeOrder(uint256 orderId) {
        require(bridgeOrders[orderId].id != 0, "Bridge order not found");
        _;
    }

    modifier onlyInitiator(uint256 swapId) {
        require(swaps[swapId].initiator == msg.sender, "Not initiator");
        _;
    }

    modifier onlyRecipient(uint256 swapId) {
        require(swaps[swapId].recipient == msg.sender, "Not recipient");
        _;
    }

    // ============ Constructor ============

    constructor(address _admin, uint256 _protocolFeeRate) {
        require(_admin != address(0), "Invalid admin address");
        require(_protocolFeeRate <= MAX_FEE_RATE, "Fee rate too high");
        
        admin = _admin;
        protocolFeeRate = _protocolFeeRate;
        swapCounter = 0;
        bridgeCounter = 0;
        paused = false;

        // Initialize supported chains
        supportedChains[CHAIN_ID_TRON] = true;
        supportedChains[CHAIN_ID_ETHEREUM] = true;
        supportedChains[CHAIN_ID_BITCOIN] = true;
        supportedChains[CHAIN_ID_STELLAR] = true;
        supportedChains[CHAIN_ID_APTOS] = true;
        supportedChains[CHAIN_ID_SUI] = true;
        supportedChains[CHAIN_ID_POLYGON] = true;
        supportedChains[CHAIN_ID_ARBITRUM] = true;
        supportedChains[CHAIN_ID_OPTIMISM] = true;
        supportedChains[CHAIN_ID_BSC] = true;
    }

    // ============ Core Functions ============

    /**
     * @dev Create a new atomic swap
     * @param recipient Address to receive the tokens
     * @param amount Amount of tokens to swap
     * @param tokenAddress Address of the token contract (0x0 for TRX)
     * @param secretHash Hash of the secret
     * @param timelock Timestamp when the swap expires
     */
    function createSwap(
        address recipient,
        uint256 amount,
        address tokenAddress,
        bytes32 secretHash,
        uint256 timelock
    ) external payable nonReentrant notPaused returns (uint256) {
        require(recipient != address(0), "Invalid recipient");
        require(recipient != msg.sender, "Cannot swap with yourself");
        require(amount > 0, "Amount must be greater than 0");
        require(secretHash != bytes32(0), "Invalid secret hash");
        require(
            timelock >= block.timestamp + MIN_TIMELOCK_DURATION,
            "Timelock too short"
        );
        require(
            timelock <= block.timestamp + MAX_TIMELOCK_DURATION,
            "Timelock too long"
        );

        // Calculate protocol fee
        uint256 protocolFee = amount.mul(protocolFeeRate).div(10000);
        uint256 swapAmount = amount.sub(protocolFee);

        // Handle TRX or TRC20 tokens
        if (tokenAddress == address(0)) {
            // TRX swap
            require(msg.value == amount, "Incorrect TRX amount");
            if (protocolFee > 0) {
                payable(admin).transfer(protocolFee);
            }
        } else {
            // TRC20 token swap
            require(msg.value == 0, "No TRX should be sent for token swap");
            require(supportedTokens[tokenAddress] || tokenAddress != address(0), "Token not supported");
            
            ITRC20 token = ITRC20(tokenAddress);
            require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
            
            if (protocolFee > 0) {
                require(token.transfer(admin, protocolFee), "Fee transfer failed");
            }
        }

        // Create swap
        swapCounter++;
        uint256 swapId = swapCounter;
        
        swaps[swapId] = SwapState({
            id: swapId,
            initiator: msg.sender,
            recipient: recipient,
            amount: swapAmount,
            tokenAddress: tokenAddress,
            secretHash: secretHash,
            timelock: timelock,
            status: SwapStatus.Active,
            createdAt: block.timestamp,
            completedAt: 0
        });

        emit SwapCreated(
            swapId,
            msg.sender,
            recipient,
            swapAmount,
            tokenAddress,
            secretHash,
            timelock,
            block.timestamp
        );

        return swapId;
    }

    /**
     * @dev Complete a swap by revealing the secret
     * @param swapId ID of the swap to complete
     * @param secret The secret that matches the hash
     */
    function completeSwap(uint256 swapId, bytes32 secret) 
        external 
        nonReentrant 
        validSwap(swapId) 
        onlyRecipient(swapId) 
    {
        SwapState storage swap = swaps[swapId];
        require(swap.status == SwapStatus.Active, "Swap not active");
        require(block.timestamp <= swap.timelock, "Swap expired");
        require(sha256(abi.encodePacked(secret)) == swap.secretHash, "Invalid secret");

        // Update swap status
        swap.status = SwapStatus.Completed;
        swap.completedAt = block.timestamp;

        // Transfer tokens to recipient
        if (swap.tokenAddress == address(0)) {
            // TRX transfer
            payable(swap.recipient).transfer(swap.amount);
        } else {
            // TRC20 token transfer
            ITRC20 token = ITRC20(swap.tokenAddress);
            require(token.transfer(swap.recipient, swap.amount), "Token transfer failed");
        }

        emit SwapCompleted(swapId, swap.recipient, swap.amount, secret, block.timestamp);
    }

    /**
     * @dev Refund a swap after it expires
     * @param swapId ID of the swap to refund
     */
    function refundSwap(uint256 swapId) 
        external 
        nonReentrant 
        validSwap(swapId) 
        onlyInitiator(swapId) 
    {
        SwapState storage swap = swaps[swapId];
        require(swap.status == SwapStatus.Active, "Swap not active");
        require(block.timestamp > swap.timelock, "Swap not expired");

        // Update swap status
        swap.status = SwapStatus.Refunded;
        swap.completedAt = block.timestamp;

        // Refund tokens to initiator
        if (swap.tokenAddress == address(0)) {
            // TRX refund
            payable(swap.initiator).transfer(swap.amount);
        } else {
            // TRC20 token refund
            ITRC20 token = ITRC20(swap.tokenAddress);
            require(token.transfer(swap.initiator, swap.amount), "Token refund failed");
        }

        emit SwapRefunded(swapId, swap.initiator, swap.amount, block.timestamp);
    }

    // ============ Cross-Chain Bridge Functions ============

    /**
     * @dev Create a cross-chain bridge order
     * @param destinationChainId Target blockchain ID
     * @param recipient Recipient address on destination chain
     * @param amount Amount to bridge
     * @param minDestinationAmount Minimum amount expected on destination
     * @param tokenAddress Token contract address (0x0 for TRX)
     * @param secretHash Hash of the secret
     * @param timelock Expiration timestamp
     */
    function createBridgeOrder(
        uint256 destinationChainId,
        string calldata recipient,
        uint256 amount,
        uint256 minDestinationAmount,
        address tokenAddress,
        bytes32 secretHash,
        uint256 timelock
    ) external payable nonReentrant notPaused returns (uint256) {
        require(supportedChains[destinationChainId], "Destination chain not supported");
        require(bytes(recipient).length > 0, "Invalid recipient");
        require(amount > 0, "Amount must be greater than 0");
        require(minDestinationAmount > 0, "Min destination amount must be greater than 0");
        require(secretHash != bytes32(0), "Invalid secret hash");
        require(
            timelock >= block.timestamp + MIN_TIMELOCK_DURATION,
            "Timelock too short"
        );

        // Calculate bridge fee
        uint256 bridgeFee = amount.mul(protocolFeeRate).div(10000);
        uint256 bridgeAmount = amount.sub(bridgeFee);

        // Handle TRX or TRC20 tokens
        if (tokenAddress == address(0)) {
            require(msg.value == amount, "Incorrect TRX amount");
            if (bridgeFee > 0) {
                payable(admin).transfer(bridgeFee);
            }
        } else {
            require(msg.value == 0, "No TRX should be sent for token bridge");
            ITRC20 token = ITRC20(tokenAddress);
            require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
            
            if (bridgeFee > 0) {
                require(token.transfer(admin, bridgeFee), "Fee transfer failed");
            }
        }

        // Create bridge order
        bridgeCounter++;
        uint256 orderId = bridgeCounter;
        
        bridgeOrders[orderId] = BridgeOrder({
            id: orderId,
            initiator: msg.sender,
            sourceChainId: CHAIN_ID_TRON,
            destinationChainId: destinationChainId,
            recipient: recipient,
            amount: bridgeAmount,
            minDestinationAmount: minDestinationAmount,
            tokenAddress: tokenAddress,
            secretHash: secretHash,
            timelock: timelock,
            status: BridgeStatus.Pending,
            createdAt: block.timestamp,
            completedAt: 0,
            sourceTxHash: "",
            destinationTxHash: ""
        });

        emit BridgeOrderCreated(
            orderId,
            msg.sender,
            destinationChainId,
            recipient,
            bridgeAmount,
            secretHash,
            timelock,
            block.timestamp
        );

        return orderId;
    }

    /**
     * @dev Complete a bridge order
     * @param orderId ID of the bridge order
     * @param secret The secret that matches the hash
     */
    function completeBridgeOrder(uint256 orderId, bytes32 secret) 
        external 
        nonReentrant 
        validBridgeOrder(orderId) 
    {
        BridgeOrder storage order = bridgeOrders[orderId];
        require(order.status == BridgeStatus.Pending, "Order not pending");
        require(block.timestamp <= order.timelock, "Order expired");
        require(sha256(abi.encodePacked(secret)) == order.secretHash, "Invalid secret");

        // Update order status
        order.status = BridgeStatus.Completed;
        order.completedAt = block.timestamp;

        // Transfer tokens to the caller (bridge resolver)
        if (order.tokenAddress == address(0)) {
            payable(msg.sender).transfer(order.amount);
        } else {
            ITRC20 token = ITRC20(order.tokenAddress);
            require(token.transfer(msg.sender, order.amount), "Token transfer failed");
        }

        emit BridgeOrderCompleted(orderId, secret, block.timestamp);
    }

    /**
     * @dev Cancel a bridge order after expiration
     * @param orderId ID of the bridge order
     */
    function cancelBridgeOrder(uint256 orderId) 
        external 
        nonReentrant 
        validBridgeOrder(orderId) 
    {
        BridgeOrder storage order = bridgeOrders[orderId];
        require(order.status == BridgeStatus.Pending, "Order not pending");
        require(
            block.timestamp > order.timelock || msg.sender == order.initiator,
            "Cannot cancel order"
        );

        // Update order status
        order.status = BridgeStatus.Cancelled;
        order.completedAt = block.timestamp;

        // Refund tokens to initiator
        if (order.tokenAddress == address(0)) {
            payable(order.initiator).transfer(order.amount);
        } else {
            ITRC20 token = ITRC20(order.tokenAddress);
            require(token.transfer(order.initiator, order.amount), "Token refund failed");
        }

        emit BridgeOrderCancelled(orderId, block.timestamp);
    }

    // ============ View Functions ============

    /**
     * @dev Get swap details
     * @param swapId ID of the swap
     */
    function getSwap(uint256 swapId) external view returns (SwapState memory) {
        return swaps[swapId];
    }

    /**
     * @dev Get bridge order details
     * @param orderId ID of the bridge order
     */
    function getBridgeOrder(uint256 orderId) external view returns (BridgeOrder memory) {
        return bridgeOrders[orderId];
    }

    /**
     * @dev Check if swap exists
     * @param swapId ID of the swap
     */
    function swapExists(uint256 swapId) external view returns (bool) {
        return swaps[swapId].id != 0;
    }

    /**
     * @dev Check if bridge order exists
     * @param orderId ID of the bridge order
     */
    function bridgeOrderExists(uint256 orderId) external view returns (bool) {
        return bridgeOrders[orderId].id != 0;
    }

    /**
     * @dev Check if swap is active
     * @param swapId ID of the swap
     */
    function isSwapActive(uint256 swapId) external view returns (bool) {
        SwapState memory swap = swaps[swapId];
        return swap.id != 0 && 
               swap.status == SwapStatus.Active && 
               block.timestamp <= swap.timelock;
    }

    /**
     * @dev Check if swap can be refunded
     * @param swapId ID of the swap
     */
    function canRefund(uint256 swapId) external view returns (bool) {
        SwapState memory swap = swaps[swapId];
        return swap.id != 0 && 
               swap.status == SwapStatus.Active && 
               block.timestamp > swap.timelock;
    }

    /**
     * @dev Check if chain is supported
     * @param chainId Chain ID to check
     */
    function isChainSupported(uint256 chainId) external view returns (bool) {
        return supportedChains[chainId];
    }

    /**
     * @dev Calculate protocol fee for amount
     * @param amount Amount to calculate fee for
     */
    function calculateProtocolFee(uint256 amount) external view returns (uint256) {
        return amount.mul(protocolFeeRate).div(10000);
    }

    // ============ Admin Functions ============

    /**
     * @dev Update protocol fee rate
     * @param newRate New fee rate in basis points
     */
    function updateProtocolFeeRate(uint256 newRate) external onlyAdmin {
        require(newRate <= MAX_FEE_RATE, "Fee rate too high");
        protocolFeeRate = newRate;
    }

    /**
     * @dev Add support for a new chain
     * @param chainId Chain ID to add
     */
    function addSupportedChain(uint256 chainId) external onlyAdmin {
        supportedChains[chainId] = true;
    }

    /**
     * @dev Remove support for a chain
     * @param chainId Chain ID to remove
     */
    function removeSupportedChain(uint256 chainId) external onlyAdmin {
        supportedChains[chainId] = false;
    }

    /**
     * @dev Add support for a new token
     * @param tokenAddress Token address to add
     */
    function addSupportedToken(address tokenAddress) external onlyAdmin {
        supportedTokens[tokenAddress] = true;
    }

    /**
     * @dev Remove support for a token
     * @param tokenAddress Token address to remove
     */
    function removeSupportedToken(address tokenAddress) external onlyAdmin {
        supportedTokens[tokenAddress] = false;
    }

    /**
     * @dev Pause the contract
     */
    function pause() external onlyAdmin {
        paused = true;
    }

    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyAdmin {
        paused = false;
    }

    /**
     * @dev Transfer admin role
     * @param newAdmin New admin address
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin address");
        admin = newAdmin;
    }

    // ============ Emergency Functions ============

    /**
     * @dev Emergency withdrawal (admin only)
     * @param tokenAddress Token address (0x0 for TRX)
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address tokenAddress, uint256 amount) external onlyAdmin {
        if (tokenAddress == address(0)) {
            payable(admin).transfer(amount);
        } else {
            ITRC20 token = ITRC20(tokenAddress);
            require(token.transfer(admin, amount), "Token transfer failed");
        }
    }
} 