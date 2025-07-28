# 1inch Fusion+ Architecture Guide for Non-EVM Implementation

## Overview

This document provides a comprehensive guide for implementing 1inch Fusion+ cross-chain swaps on non-EVM chains, based on the official 1inch developer relations workshop.

## Table of Contents

1. [Background: Evolution from Classic to Fusion+](#background)
2. [Core Concepts](#core-concepts)
3. [Fusion+ Architecture](#fusion-plus-architecture)
4. [Implementation Requirements](#implementation-requirements)
5. [Technical Specifications](#technical-specifications)
6. [Security Considerations](#security-considerations)

## Background

### 1inch Classic Swap
- **Purpose**: AMM and PMM aggregation
- **How it works**: Sources liquidity from multiple protocols, optimizes swap output, executes in single transaction
- **Example**: USDC → DAI might route through Uniswap, Curve, Sushiswap for optimal rates
- **Benefits**: Better rates for uncommon pairs and large volumes, gas optimization

### 1inch Fusion (Same-Chain)
- **Purpose**: Intent-based swaps using Dutch auctions
- **Key Features**:
  - User submits swap request with signature
  - Dutch auction created (starts high, decreases over time)
  - Resolvers compete to fill orders
  - MEV protection by design
  - Gasless for users

### 1inch Fusion+ (Cross-Chain)
- **Purpose**: Cross-chain swaps built on Fusion
- **Technology**: Hash Time-Locked Contracts (HTLCs)
- **Key Innovation**: Trustless cross-chain value transfer without bridges

## Core Concepts

### Hash Time-Locked Contracts (HTLCs)

**Definition**: A smart contract that holds funds and requires:
1. A secret `S` to unlock funds
2. Expiration after set time period

**Mechanism**:
```
1. User generates secret S
2. User creates hash(S)
3. Contract locks funds with hash(S)
4. Funds unlocked by revealing S
5. If timeout expires, funds return to sender
```

### Dutch Auction

**How it works**:
- Starts at high price (above market rate)
- Price decreases over time
- First resolver to accept wins
- Prevents front-running and MEV

### Resolver System

**Resolvers are**:
- Counterparties that fill swaps
- Watch Dutch auctions
- Provide liquidity from various sources
- Compete on execution speed and price

**Liquidity Sources**:
- Centralized exchanges
- Personal funds
- DEX arbitrage
- Cross-chain arbitrage

## Fusion+ Architecture

### Cross-Chain Swap Flow

1. **User Initiation**
   ```
   User: "Swap 50 USDC on Ethereum for DAI on Base"
   - Signs transaction
   - Sends to 1inch API
   ```

2. **Dutch Auction Creation**
   ```
   1inch API broadcasts:
   - Source chain: Ethereum
   - Destination chain: Base
   - Amount: 50 USDC
   - Dutch auction parameters
   ```

3. **Resolver Competition**
   ```
   Resolvers watch auction
   Price decreases over time
   Resolver accepts at profitable rate
   ```

4. **Escrow Contract Creation**
   ```
   Resolver creates:
   - Escrow on source chain (Ethereum)
   - Escrow on destination chain (Base)
   - Deposits safety deposit on both
   ```

5. **Fund Locking**
   ```
   Source Chain:
   - User funds (50 USDC) → Escrow
   
   Destination Chain:
   - Resolver funds (50 DAI) → Escrow
   ```

6. **Relayer Verification**
   ```
   Relayer service:
   - Monitors both escrows
   - Verifies amounts
   - Waits for finality
   - Signals completion readiness
   ```

7. **Secret Reveal**
   ```
   1. Relayer confirms readiness
   2. User reveals secret S
   3. Secret shared with resolver
   4. Resolver unlocks funds on both chains
   ```

### Safety Mechanisms

**Safety Deposit**:
- Financial incentive for completion
- If resolver fails, others can complete
- Ensures funds never get stuck

**Multiple Resolver Backup**:
- Secret shared with all resolvers
- Any resolver can complete if original fails
- Safety deposit goes to completing resolver

## Implementation Requirements

### Core Requirements

1. **Hash Time-Lock Contract Implementation**
   ```move
   struct HTLC {
       sender: address,
       receiver: address,
       amount: u64,
       hashlock: vector<u8>,    // hash(secret)
       timelock: u64,           // expiration timestamp
       secret: Option<vector<u8>>,
       withdrawn: bool,
       refunded: bool
   }
   ```

2. **Contract Functions**
   - `create_htlc()`: Lock funds with hashlock and timelock
   - `withdraw()`: Unlock with correct secret
   - `refund()`: Return funds after timeout
   - `verify_secret()`: Validate secret against hashlock

3. **Bidirectional Support**
   - EVM → Non-EVM chain
   - Non-EVM → EVM chain

4. **Integration Requirements**
   - Use 1inch escrow factory on EVM side
   - Implement compatible escrow on non-EVM side
   - Handle cross-chain orchestration

### Bonus Features for Higher Score

1. **User Interface**
   - Web UI for swap initiation
   - Transaction status tracking
   - Secret management interface

2. **Partial Fills**
   - Support multiple secrets
   - Allow multiple resolvers per swap
   - Implement partial withdrawal logic

3. **Native Implementation**
   - Implement relayer on non-EVM chain
   - Implement resolver on non-EVM chain
   - Match 1inch design patterns

4. **Mainnet Deployment**
   - Deploy on Ethereum/L2 mainnet
   - Deploy on non-EVM mainnet
   - Production-ready implementation

## Technical Specifications

### HTLC Requirements

**Create HTLC**:
```move
public fun create_htlc<T>(
    payment: Coin<T>,
    receiver: address,
    hashlock: vector<u8>,    // 32 bytes SHA-256
    timelock: u64,           // Unix timestamp
    ctx: &mut TxContext
)
```

**Withdraw (with secret)**:
```move
public fun withdraw<T>(
    htlc: &mut HTLC<T>,
    secret: vector<u8>,
    ctx: &mut TxContext
): Coin<T>
```

**Refund (after timeout)**:
```move
public fun refund<T>(
    htlc: &mut HTLC<T>,
    clock: &Clock,
    ctx: &mut TxContext
): Coin<T>
```

### Security Requirements

1. **Secret Validation**
   - Use SHA-256 for hashing
   - Verify hash(provided_secret) == stored_hashlock
   - Ensure secret is exactly 32 bytes

2. **Timing Constraints**
   - Minimum timelock: 1 hour
   - Maximum timelock: 30 days
   - Use blockchain native time source

3. **Access Control**
   - Only receiver can withdraw with secret
   - Only sender can refund after timeout
   - No admin override functions

### Cross-Chain Communication

**Relayer Service Responsibilities**:
1. Monitor escrow creation on both chains
2. Verify fund deposits match swap parameters
3. Wait for blockchain finality
4. Coordinate secret reveal between parties
5. Ensure atomic execution or revert

## Security Considerations

### Attack Vectors to Prevent

1. **Griefing Attacks**
   - User not revealing secret
   - Mitigation: Time-based refunds

2. **Front-Running**
   - Secret interception
   - Mitigation: Commit-reveal pattern

3. **Reorg Attacks**
   - Chain reorganization
   - Mitigation: Wait for finality

### Best Practices

1. **Never Trust, Always Verify**
   - Validate all inputs
   - Check contract states before operations
   - Verify cross-chain consistency

2. **Fail-Safe Design**
   - Always allow fund recovery
   - No permanent locks
   - Clear timeout mechanisms

3. **Economic Security**
   - Safety deposits must exceed gas costs
   - Incentivize proper behavior
   - Punish malicious actions

## Implementation Checklist

- [ ] Implement HTLC contract on non-EVM chain
- [ ] Support SHA-256 hashing for secrets
- [ ] Implement proper timelock with expiration
- [ ] Create withdraw function with secret validation
- [ ] Create refund function for expired swaps
- [ ] Test EVM → Non-EVM swaps
- [ ] Test Non-EVM → EVM swaps
- [ ] Implement safety deposit mechanism
- [ ] Create relayer service or equivalent
- [ ] Handle cross-chain message passing
- [ ] Ensure atomic execution or revert
- [ ] Add comprehensive error handling
- [ ] Write integration tests
- [ ] Document API and contract interfaces
- [ ] Deploy to testnet
- [ ] (Bonus) Create UI
- [ ] (Bonus) Support partial fills
- [ ] (Bonus) Deploy to mainnet

## Important Notes

1. **Do NOT use official 1inch REST APIs** - Implement at smart contract level only
2. **KYC resolvers not required** - This is for hackathon/development
3. **Start with CLI and testnet** - UI and mainnet are bonus features
4. **Use provided example repo** - `crosschain-resolver-example` on 1inch GitHub

## Resources

- Example Implementation: [1inch crosschain-resolver-example](https://github.com/1inch/crosschain-resolver-example)
- Hackathon Info: https://hackathon.1inch.community
- Original escrow factory address needed for EVM side
- Test with local forks first before testnet deployment