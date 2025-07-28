// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface ICosmosResolver {
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
        string orderHash;
        uint32 srcChainId;
        uint32 dstChainId;
        string srcToken;
        string dstToken;
        string srcAmount;
        string dstAmount;
        address resolver;
        string beneficiary;
        bytes32 secretHash;
        uint256 finalityTimestamp;
        uint256 resolverTimestamp;
        uint256 beneficiaryTimestamp;
        uint256 safetyDeposit;
    }
}

contract CosmosResolver is ICosmosResolver {
    address public owner;
    uint256 public orderCounter;
    
    mapping(uint256 => Order) public orders;
    mapping(bytes32 => uint256) public secretHashToOrderId;
    mapping(string => uint256) public cosmosOrderIdToOrderId;
    
    uint32 public constant CHAIN_ID_COSMOS = 1;
    
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
        address indexed resolver,
        string cosmosOrderId,
        uint256 amount,
        bytes32 secretHash
    );
    
    event Withdrawn(
        uint256 indexed orderId,
        address indexed user,
        uint256 amount,
        bytes32 secret
    );
    
    event Cancelled(
        uint256 indexed orderId,
        address indexed user,
        uint256 amount
    );
    
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
    
    constructor() {
        owner = msg.sender;
    }
    
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
        
        if (token == address(0)) {
            require(msg.value >= amount, "Insufficient ETH");
        } else {
            require(msg.value == 0, "ETH sent with token order");
            // In production, handle ERC20 transfer
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
            srcDeployed: true,
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
        require(safetyDeposit > 0, "Invalid safety deposit");
        require(msg.value >= safetyDeposit, "Insufficient safety deposit");
        
        order.resolver = msg.sender;
        order.safetyDeposit = safetyDeposit;
        
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
        
        order.completed = true;
        
        if (msg.sender == order.initiator) {
            // Initiator withdraws from destination
            require(order.dstDeployed, "Destination not deployed");
            require(block.timestamp <= order.timelock, "Timelock expired");
            
            if (order.token == address(0)) {
                payable(order.initiator).transfer(order.amount);
            }
            
            if (order.safetyDeposit > 0) {
                payable(order.resolver).transfer(order.safetyDeposit);
            }
        } else if (msg.sender == order.resolver) {
            // Resolver withdraws using revealed secret
            // This is handled by the source escrow in production
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
        
        if (!order.srcDeployed || order.resolver == address(0)) {
            if (order.token == address(0)) {
                payable(order.initiator).transfer(order.amount);
            }
        }
        
        if (order.safetyDeposit > 0 && order.resolver != address(0)) {
            payable(order.resolver).transfer(order.safetyDeposit);
        }
        
        emit Cancelled(orderId, msg.sender, order.amount);
    }
    
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
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
    
    function verifySecret(bytes32 secret, bytes32 secretHash) external pure returns (bool) {
        return keccak256(abi.encodePacked(secret)) == secretHash;
    }
    
    receive() external payable {}
}