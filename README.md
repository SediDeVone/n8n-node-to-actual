# n8n-to-actual-node

REST API wrapper for Actual Budget, designed to work with n8n and other automation tools.

## Why a REST Client?

Recent versions of n8n have introduced stricter sandboxing and security restrictions that block the use of the official `@actual-app/api` library directly within custom n8n nodes. The library relies on native modules (like `better-sqlite3`) and file system access that are no longer permitted in n8n's execution environment.

This project provides a **REST API wrapper** that runs as a separate service, allowing n8n (and other tools) to interact with Actual Budget through simple HTTP requests instead of direct library calls.

### Looking for the Original n8n Node?

The original custom n8n node implementation (which works with older n8n versions that don't have these restrictions) is available on the **`n8n-node`** branch of this repository.

## Features

- **REST API** for Actual Budget operations
- List budgets and accounts
- Create transactions with automatic amount conversion (dollars to milliunits)
- Works with any HTTP client (n8n HTTP Request node, curl, etc.)
- Docker support for easy deployment

## Quick Start

### Environment Variables

```bash
export ACTUAL_SERVER_URL="https://your-actual-server.com"
export ACTUAL_PASSWORD="your-server-password"
```

### Running Locally

```bash
npm install
npm run build
npm start
```

The server will start on `http://localhost:3000`.

### Running with Docker

```bash
docker-compose up -d
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/budgets` | GET | List all budgets |
| `/budgets/:budgetId/accounts` | GET | List accounts for a budget |
| `/budgets/:budgetId/transactions` | POST | Create transactions |

### Example: Create a Transaction

```bash
curl -X POST http://localhost:3000/budgets/YOUR_BUDGET_ID/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "transactions": [
      {
        "account": "YOUR_ACCOUNT_ID",
        "date": "2026-01-03",
        "amount": -25.50,
        "payee_name": "Coffee Shop",
        "notes": "Morning coffee"
      }
    ]
  }'
```

## Using with n8n

1. Deploy this REST wrapper as a service (Docker recommended)
2. In n8n, use the **HTTP Request** node to call the API endpoints
3. Configure the HTTP Request node with your REST wrapper URL

## Legacy n8n Node

The original custom n8n node implementation is available on the **`n8n-node`** branch. This version:
- Works directly with `@actual-app/api`
- Provides native n8n node UI with dropdowns for budgets and accounts
- Requires an older n8n version without strict sandboxing

To use it:
```bash
git checkout n8n-node
```

## Development

```bash
npm run dev  # Start with hot reload
```

## Files

- `src/server.ts` - REST API server implementation
- `nodes/Actual/Actual.node.ts` - Legacy n8n node (for reference)
- `credentials/ActualApi.credentials.ts` - n8n credentials definition
