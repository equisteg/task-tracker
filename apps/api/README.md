# Product Backend API (`apps/api`)

Node.js + Express backend service providing REST API contracts, task persistence, Sentinel AI telemetry, payment gateway endpoints, and merchant bank settlement services.

## Development

```bash
# Install dependencies from root
npm install

# Start development server with hot-reload
npm run dev --workspace=apps/api
```

Runs by default on port `4000`.

## Payment & Bank Payout Endpoints

- `GET /api/payments/settlement`: Inspects receiving merchant bank details.
- `POST /api/payments/settlement`: Configures and saves receiving bank account details (Holder, Account #, IFSC/Routing/SWIFT).
- `POST /api/payments/checkout`: Processes card payments or bank wire transfers and generates transaction receipts.
