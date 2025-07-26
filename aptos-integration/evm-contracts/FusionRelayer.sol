// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "./FusionHTLC.sol";

/**
 * @title FusionRelayer
 * @notice Relayer contract for cross-chain order management
 * @dev Manages cross-chain orders between EVM chains and Aptos
 */
contract FusionRelayer is Ownable, ReentrancyGuard {
    FusionHTLC public immutable htlcContract;
    
    struct CrossChainOrder {
        uint256 orderId;
        address initiator;
        uint8 sourceChain;
        uint8 destChain;
        address sourceToken;
        bytes32 destAddress; // Can be Aptos address
        uint256 sourceAmount;
        uint256 destAmount;
        bytes32 secretHash;
        uint256 expiry;
        address relayer;
        uint256 relayerFee;
        bool completed;
        bool cancelled;
    }

    mapping(uint256 => CrossChainOrder) public orders;
    mapping(address => bool) public authorizedRelayers;
    uint256 public nextOrderId = 1;
    uint256 public minRelayerFee = 0.001 ether;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed initiator,
        uint8 sourceChain,
        uint8 destChain,
        bytes32 secretHash
    );

    event OrderAccepted(uint256 indexed orderId, address indexed relayer);
    event OrderCompleted(uint256 indexed orderId, bytes32 secret);
    event OrderCancelled(uint256 indexed orderId);
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);

    modifier onlyRelayer() {
        require(authorizedRelayers[msg.sender], "Not authorized relayer");
        _;
    }

    constructor(address _htlcContract) {
        htlcContract = FusionHTLC(_htlcContract);
    }

    /**
     * @notice Create a cross-chain swap order
     * @param _destChain Destination chain ID
     * @param _sourceToken Source token address
     * @param _destAddress Destination address (32 bytes for Aptos compatibility)
     * @param _sourceAmount Amount on source chain
     * @param _destAmount Expected amount on destination chain
     * @param _secretHash Hash of the secret
     * @param _expiry Order expiration time
     */
    function createOrder(
        uint8 _destChain,
        address _sourceToken,
        bytes32 _destAddress,
        uint256 _sourceAmount,
        uint256 _destAmount,
        bytes32 _secretHash,
        uint256 _expiry
    ) external payable nonReentrant returns (uint256 orderId) {
        require(_expiry > block.timestamp, "Invalid expiry");
        require(msg.value >= minRelayerFee, "Insufficient relayer fee");

        orderId = nextOrderId++;
        
        orders[orderId] = CrossChainOrder({
            orderId: orderId,
            initiator: msg.sender,
            sourceChain: 3, // CHAIN_POLYGON
            destChain: _destChain,
            sourceToken: _sourceToken,
            destAddress: _destAddress,
            sourceAmount: _sourceAmount,
            destAmount: _destAmount,
            secretHash: _secretHash,
            expiry: _expiry,
            relayer: address(0),
            relayerFee: msg.value,
            completed: false,
            cancelled: false
        });

        emit OrderCreated(orderId, msg.sender, 3, _destChain, _secretHash); // CHAIN_POLYGON
    }

    /**
     * @notice Accept an order as a relayer
     * @param _orderId Order ID to accept
     */
    function acceptOrder(uint256 _orderId) external onlyRelayer {
        CrossChainOrder storage order = orders[_orderId];
        
        require(order.orderId != 0, "Order not found");
        require(order.relayer == address(0), "Order already accepted");
        require(!order.completed && !order.cancelled, "Order finalized");
        require(block.timestamp < order.expiry, "Order expired");

        order.relayer = msg.sender;
        emit OrderAccepted(_orderId, msg.sender);
    }

    /**
     * @notice Complete an order by providing the secret
     * @param _orderId Order ID
     * @param _secret The secret preimage
     */
    function completeOrder(uint256 _orderId, bytes32 _secret) external {
        CrossChainOrder storage order = orders[_orderId];
        
        require(order.orderId != 0, "Order not found");
        require(order.relayer == msg.sender, "Not order relayer");
        require(!order.completed && !order.cancelled, "Order finalized");
        require(keccak256(abi.encodePacked(_secret)) == order.secretHash, "Invalid secret");

        order.completed = true;

        // Transfer relayer fee
        if (order.relayerFee > 0) {
            payable(order.relayer).transfer(order.relayerFee);
        }

        emit OrderCompleted(_orderId, _secret);
    }

    /**
     * @notice Cancel an expired order
     * @param _orderId Order ID to cancel
     */
    function cancelOrder(uint256 _orderId) external {
        CrossChainOrder storage order = orders[_orderId];
        
        require(order.orderId != 0, "Order not found");
        require(msg.sender == order.initiator, "Not order initiator");
        require(!order.completed && !order.cancelled, "Order finalized");
        require(block.timestamp >= order.expiry, "Order not expired");

        order.cancelled = true;

        // Refund relayer fee
        if (order.relayerFee > 0) {
            payable(order.initiator).transfer(order.relayerFee);
        }

        emit OrderCancelled(_orderId);
    }

    /**
     * @notice Add an authorized relayer
     * @param _relayer Relayer address to add
     */
    function addRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "Invalid address");
        require(!authorizedRelayers[_relayer], "Already authorized");
        
        authorizedRelayers[_relayer] = true;
        emit RelayerAdded(_relayer);
    }

    /**
     * @notice Remove an authorized relayer
     * @param _relayer Relayer address to remove
     */
    function removeRelayer(address _relayer) external onlyOwner {
        require(authorizedRelayers[_relayer], "Not authorized");
        
        authorizedRelayers[_relayer] = false;
        emit RelayerRemoved(_relayer);
    }

    /**
     * @notice Update minimum relayer fee
     * @param _fee New minimum fee
     */
    function setMinRelayerFee(uint256 _fee) external onlyOwner {
        minRelayerFee = _fee;
    }

    /**
     * @notice Get order details
     * @param _orderId Order ID
     */
    function getOrder(uint256 _orderId) external view returns (CrossChainOrder memory) {
        return orders[_orderId];
    }
}