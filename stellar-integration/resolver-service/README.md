# Stellar-EVM Resolver Service

Automated resolver service for cross-chain atomic swaps between Stellar and EVM chains.

## Features

1. **Automated Cross-Chain Monitoring**: Monitors HTLC creation events on both Stellar and EVM chains
2. **Profit Calculation**: Evaluates opportunities based on exchange rates and gas costs
3. **Order Management**: Tracks cross-chain orders with Redis-based state management
4. **API Server**: RESTful API for monitoring resolver metrics and orders
5. **Multi-Chain Support**: Extensible architecture for adding new chains

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│ Stellar Monitor │     │   EVM Monitor   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
    ┌────────────────────────────────┐
    │         Resolver Core          │
    │  - Opportunity Evaluation      │
    │  - HTLC Creation              │
    │  - Secret Management          │
    └─────────────┬─────────────────┘
                  │
         ┌────────┴────────┐
         ▼                 ▼
┌─────────────────┐ ┌─────────────────┐
│  Order Manager  │ │  Price Oracle   │
│   (Redis DB)    │ │  (Price Feeds)  │
└─────────────────┘ └─────────────────┘
```

## Installation

```bash
cd resolver-service
npm install
```

## Configuration

1. Copy `.env.example` to `.env`
2. Configure your keys and endpoints:

```env
STELLAR_SECRET_KEY=your_stellar_secret_key
SEPOLIA_PRIVATE_KEY=your_sepolia_private_key
SEPOLIA_RPC_URL=your_rpc_url
```

## Running the Service

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## API Endpoints

- `GET /health` - Health check
- `GET /metrics` - Resolver metrics (orders, volume, success rate)
- `GET /orders` - List active orders
- `GET /orders/:id` - Get specific order details
- `GET /chains` - List supported chains and contracts

## Adding New Chains

1. Add chain configuration in `src/config/index.ts`
2. Create a new monitor in `src/services/`
3. Update `Resolver.ts` to handle the new chain
4. Add price feed in `PriceOracle.ts`

## Security Considerations

- Private keys are never logged or exposed via API
- All cross-chain swaps use atomic operations
- Timelocks ensure funds can be recovered if counterparty fails
- Profit margins protect against price fluctuations

## Monitoring

The service logs to:
- Console (with colors in dev)
- `combined.log` - All logs
- `error.log` - Errors only

## Future Enhancements

- WebSocket support for real-time updates
- Integration with 1inch Fusion+ network
- Advanced routing for multi-hop swaps
- MEV protection strategies
- Automated liquidity management