# n8n-to-actual-node

Custom n8n node to post transactions to an Actual Budget via `@actual-app/api`.

Features:
- Credentials for Actual URL and password (or local key)
- Dynamic budget dropdown (fetched from Actual)
- Dynamic account dropdown (based on chosen budget)
- Operation to create transactions from n8n items with fields: `date`, `amount`, `payee`, `notes`, `transaction_id`

See `nodes/Actual/Actual.node.ts` for the node implementation and `credentials/ActualApi.credentials.ts` for credentials definition.
