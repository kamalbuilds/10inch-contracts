// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./ICosmosResolver.sol";

/**
 * @title CosmosResolver
 * @dev EVM implementation of the Cosmos cross-chain resolver
 * @notice Handles atomic swaps between EVM chains and Cosmos
 */
contract CosmosResolver is ICosmosResolver {
    // ============ State Variables ============
    
    address public owner;
    uint256 public orderCounter;
    
    mapping(uint256 => Order) public orders;
    mapping(bytes32 => uint256) public secretHashToOrderId;
    mapping(string => uint256) public cosmosOrderIdToOrderId;
    
    // Chain IDs
    uint32 public constant CHAIN_ID_COSMOS = 1;
    uint32 public constant CHAIN_ID_ETHEREUM = 2;
    uint32 public constant CHAIN_ID_BSC = 56;
    uint32 public constant CHAIN_ID_POLYGON = 137;
    
    // ============ Modifiers ============
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier orderExists(uint256 orderId) {
        require(orders[orderId].orderId != 0, "Order not found");
        _;
    }
    
    modifier onlyResolver(uint256 orderId) {
        require(orders[orderId].resolver == msg.sender, "Not resolver");
        _;
    }
    
    // ============ Constructor ============
    
    constructor() {
        owner = msg.sender;
    }
    
    // ============ Core Functions ============
    
    function createOrder(
        uint32 dstChainId,
        string calldata dstRecipient,
        address token,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    ) external payable returns (uint256) {
        require(amount > 0, "Invalid amount");
        require(secretHash != bytes32(0), "Invalid secret hash");
        require(timelock > block.timestamp, "Invalid timelock");
        require(dstChainId == CHAIN_ID_COSMOS, "Only Cosmos supported as destination");
        
        orderCounter++;
        uint256 orderId = orderCounter;
        
        // Handle payment
        if (token == address(0)) {
            require(msg.value >= amount, "Insufficient ETH");
        } else {
            // For simplicity, assuming ERC20 transfer
            // In production, use SafeERC20
            require(msg.value == 0, "ETH sent with token order");
            // IERC20(token).transferFrom(msg.sender, address(this), amount);
        }
        
        orders[orderId] = Order({
            orderId: orderId,
            initiator: msg.sender,
            resolver: address(0),
            srcChainId: uint32(block.chainid),
            dstChainId: dstChainId,
            token: token,
            amount: amount,
            dstRecipient: dstRecipient,
            secretHash: secretHash,
            timelock: timelock,
            safetyDeposit: 0,
            srcDeployed: false,
            dstDeployed: false,
            completed: false,
            cancelled: false
        });
        
        secretHashToOrderId[secretHash] = orderId;
        
        emit OrderCreated(
            orderId,
            msg.sender,
            address(0),
            dstChainId,
            dstRecipient,
            secretHash,
            amount,
            timelock
        );
        
        return orderId;
    }
    
    function fillOrder(
        uint256 orderId,
        uint256 safetyDeposit
    ) external payable orderExists(orderId) {
        Order storage order = orders[orderId];
        
        require(order.resolver == address(0), "Already filled");
        require(!order.srcDeployed, "Source already deployed");
        require(safetyDeposit > 0, "Invalid safety deposit");
        require(msg.value >= safetyDeposit, "Insufficient safety deposit");
        
        order.resolver = msg.sender;
        order.safetyDeposit = safetyDeposit;
        order.srcDeployed = true;
        
        // In production, this would trigger cross-chain message to Cosmos
        
        emit OrderCreated(
            orderId,
            order.initiator,
            msg.sender,
            order.dstChainId,
            order.dstRecipient,
            order.secretHash,
            order.amount,
            order.timelock
        );
    }
    
    function deployDstEscrow(
        uint256 orderId,
        string calldata cosmosOrderId,
        CosmosEscrowImmutables calldata immutables
    ) external orderExists(orderId) onlyResolver(orderId) {
        Order storage order = orders[orderId];
        
        require(order.srcDeployed, "Source not deployed");
        require(!order.dstDeployed, "Destination already deployed");
        require(immutables.secretHash == order.secretHash, "Secret hash mismatch");
        
        order.dstDeployed = true;
        cosmosOrderIdToOrderId[cosmosOrderId] = orderId;
        
        emit DstEscrowDeployed(
            orderId,
            msg.sender,
            cosmosOrderId,
            order.amount,
            order.secretHash
        );
    }
    
    function withdraw(
        uint256 orderId,
        bytes32 secret
    ) external orderExists(orderId) {
        Order storage order = orders[orderId];
        
        require(!order.completed, "Already completed");
        require(!order.cancelled, "Already cancelled");
        require(keccak256(abi.encodePacked(secret)) == order.secretHash, "Invalid secret");
        
        if (msg.sender == order.initiator) {
            // Initiator withdraws from destination (this contract)
            require(order.dstDeployed, "Destination not deployed");
            require(block.timestamp <= order.timelock, "Timelock expired");
            
            order.completed = true;
            
            // Transfer funds to initiator
            if (order.token == address(0)) {
                payable(order.initiator).transfer(order.amount);
            } else {
                // IERC20(order.token).transfer(order.initiator, order.amount);
            }
            
            // Return safety deposit to resolver
            if (order.safetyDeposit > 0) {
                payable(order.resolver).transfer(order.safetyDeposit);
            }
            
        } else if (msg.sender == order.resolver) {
            // Resolver withdraws after getting secret
            require(order.srcDeployed, "Source not deployed");
            
            // In production, verify secret was revealed on Cosmos
            order.completed = true;
            
            // This would be handled by the escrow contract
        } else {
            revert("Not authorized");
        }
        
        emit Withdrawn(orderId, msg.sender, order.amount, secret);
    }
    
    function cancel(uint256 orderId) external orderExists(orderId) {
        Order storage order = orders[orderId];
        
        require(!order.completed, "Already completed");
        require(!order.cancelled, "Already cancelled");
        require(block.timestamp > order.timelock, "Timelock not expired");
        
        require(
            msg.sender == order.initiator || msg.sender == order.resolver,
            "Not authorized"
        );
        
        order.cancelled = true;
        
        // Refund initiator
        if (!order.srcDeployed || order.resolver == address(0)) {
            if (order.token == address(0)) {
                payable(order.initiator).transfer(order.amount);
            } else {
                // IERC20(order.token).transfer(order.initiator, order.amount);
            }
        }
        
        // Return safety deposit
        if (order.safetyDeposit > 0 && order.resolver != address(0)) {
            payable(order.resolver).transfer(order.safetyDeposit);
        }
        
        emit Cancelled(orderId, msg.sender, order.amount);
    }
    
    // ============ View Functions ============
    
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }
    
    function getOrderBySecretHash(bytes32 secretHash) external view returns (uint256) {
        return secretHashToOrderId[secretHash];
    }
    
    function canWithdraw(uint256 orderId, address user) external view returns (bool) {
        Order memory order = orders[orderId];
        
        if (order.completed || order.cancelled) return false;
        
        if (user == order.initiator && order.dstDeployed && block.timestamp <= order.timelock) {
            return true;
        }
        
        if (user == order.resolver && order.srcDeployed) {
            return true;
        }
        
        return false;
    }
    
    function canCancel(uint256 orderId) external view returns (bool) {
        Order memory order = orders[orderId];
        
        return !order.completed && 
               !order.cancelled && 
               block.timestamp > order.timelock;
    }
    
    function verifySecret(bytes32 secret, bytes32 secretHash) external pure returns (bool) {
        return keccak256(abi.encodePacked(secret)) == secretHash;
    }
    
    // ============ Admin Functions ============
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
    
    // ============ Receive Function ============
    
    receive() external payable {}
}