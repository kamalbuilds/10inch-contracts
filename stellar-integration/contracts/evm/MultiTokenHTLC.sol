// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract MultiTokenHTLC {
    struct HTLC {
        address sender;
        address receiver;
        address token; // address(0) for ETH
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool withdrawn;
        bool refunded;
        bytes32 preimage;
    }

    mapping(bytes32 => HTLC) public contracts;
    mapping(address => bool) public supportedTokens;
    mapping(address => TokenConfig) public tokenConfigs;
    
    struct TokenConfig {
        bool enabled;
        uint256 minAmount;
        uint256 maxAmount;
        uint256 fee; // in basis points (1 = 0.01%)
    }

    address public admin;
    bool public paused;
    uint256 public htlcCounter;

    event HTLCCreated(
        bytes32 indexed contractId,
        address indexed sender,
        address indexed receiver,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    );

    event HTLCWithdrawn(bytes32 indexed contractId, bytes32 preimage);
    event HTLCRefunded(bytes32 indexed contractId);
    event TokenAdded(address indexed token);
    event TokenUpdated(address indexed token);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier notPaused() {
        require(!paused, "Contract paused");
        _;
    }

    constructor() {
        admin = msg.sender;
        // Support ETH by default
        supportedTokens[address(0)] = true;
        tokenConfigs[address(0)] = TokenConfig({
            enabled: true,
            minAmount: 0.001 ether,
            maxAmount: 100 ether,
            fee: 10 // 0.1%
        });
    }

    function addToken(
        address token,
        uint256 minAmount,
        uint256 maxAmount,
        uint256 fee
    ) external onlyAdmin {
        require(token != address(0), "Use updateToken for ETH");
        supportedTokens[token] = true;
        tokenConfigs[token] = TokenConfig({
            enabled: true,
            minAmount: minAmount,
            maxAmount: maxAmount,
            fee: fee
        });
        emit TokenAdded(token);
    }

    function updateToken(
        address token,
        bool enabled,
        uint256 minAmount,
        uint256 maxAmount,
        uint256 fee
    ) external onlyAdmin {
        require(supportedTokens[token], "Token not supported");
        tokenConfigs[token] = TokenConfig({
            enabled: enabled,
            minAmount: minAmount,
            maxAmount: maxAmount,
            fee: fee
        });
        emit TokenUpdated(token);
    }

    function createHTLC(
        address _receiver,
        bytes32 _hashlock,
        uint256 _timelock
    ) external payable notPaused returns (bytes32 contractId) {
        return _createHTLC(
            msg.sender,
            _receiver,
            address(0), // ETH
            msg.value,
            _hashlock,
            _timelock
        );
    }

    function createHTLCWithToken(
        address _token,
        address _receiver,
        uint256 _amount,
        bytes32 _hashlock,
        uint256 _timelock
    ) external notPaused returns (bytes32 contractId) {
        require(_token != address(0), "Use createHTLC for ETH");
        
        // Transfer tokens to contract
        require(
            IERC20(_token).transferFrom(msg.sender, address(this), _amount),
            "Token transfer failed"
        );

        return _createHTLC(
            msg.sender,
            _receiver,
            _token,
            _amount,
            _hashlock,
            _timelock
        );
    }

    function _createHTLC(
        address _sender,
        address _receiver,
        address _token,
        uint256 _amount,
        bytes32 _hashlock,
        uint256 _timelock
    ) private returns (bytes32 contractId) {
        require(supportedTokens[_token], "Token not supported");
        TokenConfig memory config = tokenConfigs[_token];
        require(config.enabled, "Token disabled");
        require(_amount >= config.minAmount, "Amount below minimum");
        require(_amount <= config.maxAmount, "Amount above maximum");
        require(_timelock > block.timestamp, "Timelock must be in future");

        htlcCounter++;
        contractId = keccak256(
            abi.encodePacked(_sender, _receiver, _token, _amount, _hashlock, _timelock, htlcCounter)
        );

        require(contracts[contractId].sender == address(0), "Contract exists");

        contracts[contractId] = HTLC({
            sender: _sender,
            receiver: _receiver,
            token: _token,
            amount: _amount,
            hashlock: _hashlock,
            timelock: _timelock,
            withdrawn: false,
            refunded: false,
            preimage: 0x0
        });

        emit HTLCCreated(contractId, _sender, _receiver, _token, _amount, _hashlock, _timelock);
    }

    function withdraw(bytes32 _contractId, bytes32 _preimage) external {
        HTLC storage htlc = contracts[_contractId];
        
        require(htlc.sender != address(0), "HTLC not found");
        require(htlc.receiver == msg.sender, "Not receiver");
        require(!htlc.withdrawn, "Already withdrawn");
        require(!htlc.refunded, "Already refunded");
        require(keccak256(abi.encodePacked(_preimage)) == htlc.hashlock, "Invalid preimage");
        require(block.timestamp < htlc.timelock, "Timelock expired");

        htlc.withdrawn = true;
        htlc.preimage = _preimage;

        // Calculate fee
        TokenConfig memory config = tokenConfigs[htlc.token];
        uint256 fee = (htlc.amount * config.fee) / 10000;
        uint256 amountAfterFee = htlc.amount - fee;

        // Transfer tokens/ETH
        if (htlc.token == address(0)) {
            // ETH
            payable(htlc.receiver).transfer(amountAfterFee);
            if (fee > 0) {
                payable(admin).transfer(fee);
            }
        } else {
            // ERC20
            require(
                IERC20(htlc.token).transfer(htlc.receiver, amountAfterFee),
                "Token transfer failed"
            );
            if (fee > 0) {
                require(
                    IERC20(htlc.token).transfer(admin, fee),
                    "Fee transfer failed"
                );
            }
        }

        emit HTLCWithdrawn(_contractId, _preimage);
    }

    function refund(bytes32 _contractId) external {
        HTLC storage htlc = contracts[_contractId];
        
        require(htlc.sender != address(0), "HTLC not found");
        require(htlc.sender == msg.sender, "Not sender");
        require(!htlc.withdrawn, "Already withdrawn");
        require(!htlc.refunded, "Already refunded");
        require(block.timestamp >= htlc.timelock, "Timelock not expired");

        htlc.refunded = true;

        // Transfer tokens/ETH back
        if (htlc.token == address(0)) {
            // ETH
            payable(htlc.sender).transfer(htlc.amount);
        } else {
            // ERC20
            require(
                IERC20(htlc.token).transfer(htlc.sender, htlc.amount),
                "Token transfer failed"
            );
        }

        emit HTLCRefunded(_contractId);
    }

    function getContract(bytes32 _contractId) external view returns (
        address sender,
        address receiver,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        bool withdrawn,
        bool refunded,
        bytes32 preimage
    ) {
        HTLC memory htlc = contracts[_contractId];
        return (
            htlc.sender,
            htlc.receiver,
            htlc.token,
            htlc.amount,
            htlc.hashlock,
            htlc.timelock,
            htlc.withdrawn,
            htlc.refunded,
            htlc.preimage
        );
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
    }

    function setAdmin(address _admin) external onlyAdmin {
        require(_admin != address(0), "Invalid admin");
        admin = _admin;
    }
}