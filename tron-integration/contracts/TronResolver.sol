// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title TronResolver
 * @dev Resolver contract for cross-chain atomic swaps on Tron
 * @notice Handles the relayer/resolver functionality for 1inch Fusion+
 */

import "./interfaces/ITRC20.sol";
import "./TronAtomicSwap.sol";
import "./libraries/SafeMath.sol";
import "./libraries/ReentrancyGuard.sol";

contract TronResolver is ReentrancyGuard {
    using SafeMath for uint256;

    // ============ Events ============
    
    event SrcEscrowDeployed(
        uint256 indexed orderId,
        address indexed resolver,
        bytes32 secretHash,
        uint256 srcAmount,
        uint256 safetyDeposit,
        uint256 timelock
    );
    
    event DstEscrowDeployed(
        uint256 indexed orderId,
        address indexed resolver,
        uint256 dstChainId,
        string dstAddress,
        uint256 dstAmount,
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
    
    struct ResolverOrder {
        uint256 orderId;
        address initiator;
        address resolver;
        uint256 srcChainId;
        uint256 dstChainId;
        uint256 srcAmount;
        uint256 dstAmount;
        uint256 safetyDeposit;
        address tokenAddress;
        bytes32 secretHash;
        uint256 srcTimelock;
        uint256 dstTimelock;
        bool srcDeployed;
        bool dstDeployed;
        bool completed;
        bool cancelled;
    }

    // ============ Storage ============
    
    address public owner;
    TronAtomicSwap public atomicSwap;
    uint256 public orderCounter;
    mapping(uint256 => ResolverOrder) public orders;
    mapping(bytes32 => uint256) public secretHashToOrderId;

    // ============ Modifiers ============
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier onlyResolver(uint256 orderId) {
        require(orders[orderId].resolver == msg.sender, "Not resolver");
        _;
    }
    
    modifier orderExists(uint256 orderId) {
        require(orders[orderId].orderId != 0, "Order not found");
        _;
    }

    // ============ Constructor ============
    
    constructor(address _atomicSwap) {
        owner = msg.sender;
        atomicSwap = TronAtomicSwap(_atomicSwap);
    }

    // ============ Core Functions ============
    
    /**
     * @dev Deploy source escrow and fill the cross-chain order
     * @param initiator Address that created the original order
     * @param dstChainId Destination chain ID
     * @param dstAddress Destination address on the other chain
     * @param srcAmount Amount on source chain
     * @param dstAmount Amount expected on destination chain
     * @param tokenAddress Token address (0x0 for TRX)
     * @param secretHash Hash of the secret
     * @param safetyDeposit Safety deposit amount
     * @param timelock Expiration timestamp
     */
    function deploySrc(
        address initiator,
        uint256 dstChainId,
        string calldata dstAddress,
        uint256 srcAmount,
        uint256 dstAmount,
        address tokenAddress,
        bytes32 secretHash,
        uint256 safetyDeposit,
        uint256 timelock
    ) external payable nonReentrant returns (uint256) {
        require(srcAmount > 0, "Invalid amount");
        require(safetyDeposit > 0, "Invalid safety deposit");
        require(secretHash != bytes32(0), "Invalid secret hash");
        require(timelock > block.timestamp, "Invalid timelock");
        
        orderCounter++;
        uint256 orderId = orderCounter;
        
        // Store order details
        orders[orderId] = ResolverOrder({
            orderId: orderId,
            initiator: initiator,
            resolver: msg.sender,
            srcChainId: 1, // Tron
            dstChainId: dstChainId,
            srcAmount: srcAmount,
            dstAmount: dstAmount,
            safetyDeposit: safetyDeposit,
            tokenAddress: tokenAddress,
            secretHash: secretHash,
            srcTimelock: timelock,
            dstTimelock: timelock + 3600, // 1 hour extra for dst
            srcDeployed: true,
            dstDeployed: false,
            completed: false,
            cancelled: false
        });
        
        secretHashToOrderId[secretHash] = orderId;
        
        // Handle payment and safety deposit
        if (tokenAddress == address(0)) {
            // TRX
            require(msg.value >= srcAmount.add(safetyDeposit), "Insufficient TRX");
        } else {
            // TRC20
            require(msg.value >= safetyDeposit, "Insufficient safety deposit");
            ITRC20 token = ITRC20(tokenAddress);
            require(token.transferFrom(msg.sender, address(this), srcAmount), "Token transfer failed");
        }
        
        emit SrcEscrowDeployed(
            orderId,
            msg.sender,
            secretHash,
            srcAmount,
            safetyDeposit,
            timelock
        );
        
        return orderId;
    }
    
    /**
     * @dev Deploy destination escrow (called by resolver on destination chain)
     * @param orderId Order ID from source chain
     * @param initiator Original order creator
     * @param amount Amount to lock on destination
     * @param tokenAddress Token on destination chain
     */
    function deployDst(
        uint256 orderId,
        address initiator,
        uint256 amount,
        address tokenAddress
    ) external payable orderExists(orderId) onlyResolver(orderId) {
        ResolverOrder storage order = orders[orderId];
        require(!order.dstDeployed, "Dst already deployed");
        require(order.srcDeployed, "Src not deployed");
        
        order.dstDeployed = true;
        
        // This would be called on the destination chain
        // For demo purposes, we're simulating it here
        
        emit DstEscrowDeployed(
            orderId,
            msg.sender,
            order.dstChainId,
            "", // Would be actual dst address
            amount,
            order.secretHash
        );
    }
    
    /**
     * @dev Withdraw funds by revealing the secret
     * @param orderId Order ID
     * @param secret The secret that matches the hash
     * @param isSourceChain Whether withdrawing from source chain
     */
    function withdraw(
        uint256 orderId,
        bytes32 secret,
        bool isSourceChain
    ) external nonReentrant orderExists(orderId) {
        ResolverOrder storage order = orders[orderId];
        require(!order.completed, "Already completed");
        require(!order.cancelled, "Already cancelled");
        require(keccak256(abi.encodePacked(secret)) == order.secretHash, "Invalid secret");
        
        if (isSourceChain) {
            // Resolver withdraws from source after secret revealed
            require(msg.sender == order.resolver, "Not resolver");
            require(block.timestamp <= order.srcTimelock, "Source expired");
            
            // Transfer funds to resolver
            if (order.tokenAddress == address(0)) {
                payable(order.resolver).transfer(order.srcAmount);
            } else {
                ITRC20 token = ITRC20(order.tokenAddress);
                require(token.transfer(order.resolver, order.srcAmount), "Token transfer failed");
            }
            
            // Return safety deposit
            payable(order.resolver).transfer(order.safetyDeposit);
            
        } else {
            // User withdraws from destination
            require(msg.sender == order.initiator, "Not initiator");
            
            // In real implementation, this would be on destination chain
            // Here we simulate by marking completed
            order.completed = true;
        }
        
        emit Withdrawn(orderId, msg.sender, order.srcAmount, secret);
    }
    
    /**
     * @dev Cancel expired order
     * @param orderId Order ID
     */
    function cancel(uint256 orderId) external nonReentrant orderExists(orderId) {
        ResolverOrder storage order = orders[orderId];
        require(!order.completed, "Already completed");
        require(!order.cancelled, "Already cancelled");
        
        if (block.timestamp > order.srcTimelock) {
            // After timeout, initiator can cancel and get refund
            require(msg.sender == order.initiator || msg.sender == order.resolver, "Not authorized");
            
            order.cancelled = true;
            
            // Refund to original parties
            if (order.srcDeployed) {
                if (order.tokenAddress == address(0)) {
                    payable(order.initiator).transfer(order.srcAmount);
                } else {
                    ITRC20 token = ITRC20(order.tokenAddress);
                    require(token.transfer(order.initiator, order.srcAmount), "Token transfer failed");
                }
                
                // Return safety deposit to resolver
                payable(order.resolver).transfer(order.safetyDeposit);
            }
            
            emit Cancelled(orderId, msg.sender, order.srcAmount);
        } else {
            revert("Not expired yet");
        }
    }
    
    // ============ View Functions ============
    
    function getOrder(uint256 orderId) external view returns (ResolverOrder memory) {
        return orders[orderId];
    }
    
    function getOrderBySecretHash(bytes32 secretHash) external view returns (uint256) {
        return secretHashToOrderId[secretHash];
    }
    
    function canWithdraw(uint256 orderId, address user) external view returns (bool) {
        ResolverOrder memory order = orders[orderId];
        if (order.completed || order.cancelled) return false;
        if (user == order.resolver && block.timestamp <= order.srcTimelock) return true;
        if (user == order.initiator && order.dstDeployed) return true;
        return false;
    }
    
    function canCancel(uint256 orderId) external view returns (bool) {
        ResolverOrder memory order = orders[orderId];
        return !order.completed && 
               !order.cancelled && 
               block.timestamp > order.srcTimelock;
    }
    
    // ============ Admin Functions ============
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
    
    function updateAtomicSwap(address newAtomicSwap) external onlyOwner {
        atomicSwap = TronAtomicSwap(newAtomicSwap);
    }
}