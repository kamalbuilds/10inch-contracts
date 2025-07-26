// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FusionHTLC
 * @notice Hash Time-Locked Contract for 1inch Fusion+ cross-chain swaps
 * @dev Compatible with Aptos Fusion+ implementation
 */
contract FusionHTLC is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Chain IDs matching Aptos implementation
    uint8 public constant CHAIN_APTOS = 0;
    uint8 public constant CHAIN_ETHEREUM = 1;
    uint8 public constant CHAIN_BSC = 2;
    uint8 public constant CHAIN_POLYGON = 3;

    struct HTLC {
        address sender;
        address receiver;
        address token;
        uint256 amount;
        bytes32 secretHash;
        uint256 timelock;
        bool withdrawn;
        bool refunded;
        bytes32 secret;
    }

    mapping(bytes32 => HTLC) public htlcs;
    mapping(address => uint256) public nonces;

    event HTLCCreated(
        bytes32 indexed htlcId,
        address indexed sender,
        address indexed receiver,
        address token,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );

    event HTLCWithdrawn(bytes32 indexed htlcId, bytes32 secret);
    event HTLCRefunded(bytes32 indexed htlcId);

    /**
     * @notice Create a new HTLC
     * @param _receiver Receiver address
     * @param _token Token address (address(0) for native token)
     * @param _amount Amount to lock
     * @param _secretHash Hash of the secret
     * @param _timelock Expiration timestamp
     * @return htlcId Unique HTLC identifier
     */
    function createHTLC(
        address _receiver,
        address _token,
        uint256 _amount,
        bytes32 _secretHash,
        uint256 _timelock
    ) external payable nonReentrant returns (bytes32 htlcId) {
        require(_receiver != address(0), "Invalid receiver");
        require(_amount > 0, "Invalid amount");
        require(_timelock > block.timestamp, "Invalid timelock");

        // Generate unique HTLC ID
        htlcId = keccak256(
            abi.encodePacked(
                msg.sender,
                _receiver,
                _token,
                _amount,
                _secretHash,
                _timelock,
                nonces[msg.sender]++
            )
        );

        require(htlcs[htlcId].sender == address(0), "HTLC already exists");

        // Handle token transfer
        if (_token == address(0)) {
            require(msg.value == _amount, "Invalid ETH amount");
        } else {
            require(msg.value == 0, "ETH not accepted for token transfer");
            IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        }

        htlcs[htlcId] = HTLC({
            sender: msg.sender,
            receiver: _receiver,
            token: _token,
            amount: _amount,
            secretHash: _secretHash,
            timelock: _timelock,
            withdrawn: false,
            refunded: false,
            secret: bytes32(0)
        });

        emit HTLCCreated(
            htlcId,
            msg.sender,
            _receiver,
            _token,
            _amount,
            _secretHash,
            _timelock
        );
    }

    /**
     * @notice Withdraw funds by providing the secret
     * @param _htlcId HTLC identifier
     * @param _secret The secret preimage
     */
    function withdraw(bytes32 _htlcId, bytes32 _secret) external nonReentrant {
        HTLC storage htlc = htlcs[_htlcId];
        
        require(htlc.sender != address(0), "HTLC not found");
        require(msg.sender == htlc.receiver, "Not receiver");
        require(!htlc.withdrawn, "Already withdrawn");
        require(!htlc.refunded, "Already refunded");
        require(sha256(abi.encodePacked(_secret)) == htlc.secretHash, "Invalid secret");

        htlc.withdrawn = true;
        htlc.secret = _secret;

        // Transfer funds
        if (htlc.token == address(0)) {
            payable(htlc.receiver).transfer(htlc.amount);
        } else {
            IERC20(htlc.token).safeTransfer(htlc.receiver, htlc.amount);
        }

        emit HTLCWithdrawn(_htlcId, _secret);
    }

    /**
     * @notice Refund funds after timelock expires
     * @param _htlcId HTLC identifier
     */
    function refund(bytes32 _htlcId) external nonReentrant {
        HTLC storage htlc = htlcs[_htlcId];
        
        require(htlc.sender != address(0), "HTLC not found");
        require(msg.sender == htlc.sender, "Not sender");
        require(!htlc.withdrawn, "Already withdrawn");
        require(!htlc.refunded, "Already refunded");
        require(block.timestamp >= htlc.timelock, "Timelock not expired");

        htlc.refunded = true;

        // Refund to sender
        if (htlc.token == address(0)) {
            payable(htlc.sender).transfer(htlc.amount);
        } else {
            IERC20(htlc.token).safeTransfer(htlc.sender, htlc.amount);
        }

        emit HTLCRefunded(_htlcId);
    }

    /**
     * @notice Get HTLC details
     * @param _htlcId HTLC identifier
     */
    function getHTLC(bytes32 _htlcId) external view returns (
        address sender,
        address receiver,
        address token,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock,
        bool withdrawn,
        bool refunded,
        bytes32 secret
    ) {
        HTLC storage htlc = htlcs[_htlcId];
        return (
            htlc.sender,
            htlc.receiver,
            htlc.token,
            htlc.amount,
            htlc.secretHash,
            htlc.timelock,
            htlc.withdrawn,
            htlc.refunded,
            htlc.secret
        );
    }
}