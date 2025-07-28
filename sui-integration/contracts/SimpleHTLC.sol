// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title SimpleHTLC
 * @dev Simple Hash Time-Locked Contract for testing cross-chain swaps
 * This contract can be deployed once on Sepolia and used by all non-EVM chains
 */
contract SimpleHTLC {
    struct HTLC {
        address sender;
        address receiver;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        bool withdrawn;
        bool refunded;
        bytes32 preimage;
    }

    mapping(bytes32 => HTLC) public contracts;
    
    event HTLCCreated(
        bytes32 indexed contractId,
        address indexed sender,
        address indexed receiver,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    );
    
    event HTLCWithdrawn(bytes32 indexed contractId, bytes32 preimage);
    event HTLCRefunded(bytes32 indexed contractId);

    modifier htlcExists(bytes32 _contractId) {
        require(contracts[_contractId].amount > 0, "HTLC does not exist");
        _;
    }

    modifier hashlockMatches(bytes32 _contractId, bytes32 _preimage) {
        require(
            contracts[_contractId].hashlock == sha256(abi.encodePacked(_preimage)),
            "Hashlock does not match"
        );
        _;
    }

    modifier withdrawable(bytes32 _contractId) {
        require(contracts[_contractId].withdrawn == false, "Already withdrawn");
        require(contracts[_contractId].timelock > block.timestamp, "Timelock expired");
        _;
    }

    modifier refundable(bytes32 _contractId) {
        require(contracts[_contractId].refunded == false, "Already refunded");
        require(contracts[_contractId].withdrawn == false, "Already withdrawn");
        require(contracts[_contractId].timelock <= block.timestamp, "Timelock not yet passed");
        _;
    }

    /**
     * @dev Create a new HTLC
     * @param _receiver Address that can withdraw with the correct preimage
     * @param _hashlock Hash of the secret (using sha256)
     * @param _timelock Timestamp after which the sender can refund
     * @return contractId Unique identifier for this HTLC
     */
    function createHTLC(
        address _receiver,
        bytes32 _hashlock,
        uint256 _timelock
    ) external payable returns (bytes32 contractId) {
        require(msg.value > 0, "Amount must be greater than 0");
        require(_timelock > block.timestamp, "Timelock must be in the future");
        
        contractId = keccak256(
            abi.encodePacked(
                msg.sender,
                _receiver,
                msg.value,
                _hashlock,
                _timelock,
                block.timestamp
            )
        );
        
        require(contracts[contractId].amount == 0, "Contract already exists");
        
        contracts[contractId] = HTLC({
            sender: msg.sender,
            receiver: _receiver,
            amount: msg.value,
            hashlock: _hashlock,
            timelock: _timelock,
            withdrawn: false,
            refunded: false,
            preimage: 0x0
        });
        
        emit HTLCCreated(
            contractId,
            msg.sender,
            _receiver,
            msg.value,
            _hashlock,
            _timelock
        );
    }

    /**
     * @dev Withdraw funds by providing the correct preimage
     * @param _contractId Unique identifier of the HTLC
     * @param _preimage The secret that hashes to the hashlock
     */
    function withdraw(bytes32 _contractId, bytes32 _preimage)
        external
        htlcExists(_contractId)
        hashlockMatches(_contractId, _preimage)
        withdrawable(_contractId)
    {
        HTLC storage htlc = contracts[_contractId];
        require(msg.sender == htlc.receiver, "Only receiver can withdraw");
        
        htlc.preimage = _preimage;
        htlc.withdrawn = true;
        
        emit HTLCWithdrawn(_contractId, _preimage);
        
        payable(htlc.receiver).transfer(htlc.amount);
    }

    /**
     * @dev Refund funds after timelock expires
     * @param _contractId Unique identifier of the HTLC
     */
    function refund(bytes32 _contractId)
        external
        htlcExists(_contractId)
        refundable(_contractId)
    {
        HTLC storage htlc = contracts[_contractId];
        require(msg.sender == htlc.sender, "Only sender can refund");
        
        htlc.refunded = true;
        
        emit HTLCRefunded(_contractId);
        
        payable(htlc.sender).transfer(htlc.amount);
    }

    /**
     * @dev Get HTLC details
     * @param _contractId Unique identifier of the HTLC
     */
    function getContract(bytes32 _contractId)
        external
        view
        returns (
            address sender,
            address receiver,
            uint256 amount,
            bytes32 hashlock,
            uint256 timelock,
            bool withdrawn,
            bool refunded,
            bytes32 preimage
        )
    {
        HTLC memory htlc = contracts[_contractId];
        return (
            htlc.sender,
            htlc.receiver,
            htlc.amount,
            htlc.hashlock,
            htlc.timelock,
            htlc.withdrawn,
            htlc.refunded,
            htlc.preimage
        );
    }
}