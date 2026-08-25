# Paystack Direct Debit & Webhook Demo

A lightweight Node.js demo service simulating a lending engine integrated with **Paystack Direct Debit**. It covers the complete lifecycle: borrower loan onboarding, mandate authorization initialization, secure webhook event processing (with HMAC SHA-512 validation and idempotency guards), and recurring repayment charges.

---

## What's Inside

- **ES Modules & Zero Boilerplate**: Built with native Node.js ESM (`"type": "module"`).
- **Embedded Persistence**: Uses [Lowdb](https://github.com/typicode/lowdb) (`db.json`) so borrowers, mandates, repayments, and webhook logs persist across server restarts.
- **Paystack Webhook Verification**: Computes and verifies `x-paystack-signature` using HMAC SHA-512 against raw request bodies.
- **Idempotency**: Prevents double-processing of webhook retries using unique event deduplication and entity guards.
- **Ready-to-use Postman Collection**: Includes pre-configured requests with automated variable passing and signature generation.

---

## Project Structure

```
├── src/
│   ├── config.js               # Centralized config loaded from environment
│   ├── db.js                   # Lowdb setup & helper query methods
│   ├── main.js                 # Express server bootstrap & route mounting
│   └── routes/
│       ├── loans.routes.js     # Borrower & loan onboarding (/loans)
│       ├── mandates.routes.js  # Mandate init & charging (/mandates)
│       └── webhooks.routes.js  # Webhook listener & logs (/webhooks)
├── db.json                     # Local JSON database (auto-generated)
├── postman_collection.json     # Postman collection for testing
└── package.json
```

---

## Getting Started

### 1. Requirements
- Node.js **v20.6.0+** (uses native `--env-file` support)
- A Paystack account (test keys work fine)

### 2. Installation & Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
```

Edit your `.env` file with your Paystack secret key:

```ini
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
PAYSTACK_BASE_URL=https://api.paystack.co
PORT=8888
```

### 3. Run the Server

```bash
# Development (with watch mode)
npm run dev

# Production
npm start
```

The server will be available at `http://localhost:8888`.

---

## Workflow & Endpoints

### 1. Onboard Borrower & Loan
- `POST /loans/onboard`
- Creates borrower profile and loan in `PENDING_MANDATE` status.

### 2. Initialize Direct Debit Mandate
- `POST /mandates/initialize`
- Calls Paystack's `/customer/authorization/initialize` endpoint.
- Returns a `redirect_url` where the customer authorizes the mandate.
- Saves the mandate `reference` on the borrower record.

### 3. Webhook Listener
- `POST /webhooks/listen`
- Verifies Paystack `x-paystack-signature` header.
- Saves all verified webhooks in `db.json`.
- `direct_debit.authorization.created`: Links `authCode` to borrower, sets loan to `APPROVED`.
- `direct_debit.authorization.active`: Activates mandate, sets loan to `ACTIVE`.
- `charge.success`: Logs repayment record.
- `GET /webhooks/logs`: Helper endpoint to view all captured webhook payloads.

### 4. Charge Repayment
- `POST /mandates/charge-repayment`
- Debits borrower's account using their active `authCode` via Paystack's `/transaction/charge_authorization`.

---

## Testing with Postman

Import `postman_collection.json` into Postman:

1. Run `1. Onboard Borrower & Loan`: Automatically saves `borrowerId` into collection variables.
2. Run `2. Initialize Mandate`: Automatically saves the returned Paystack `reference`.
3. Test webhooks under the **Webhooks (Paystack)** folder: The pre-request script auto-signs payloads using HMAC SHA-512 with your secret key.

---

## Webhook Idempotency

Paystack uses at-least-once delivery and will retry sending webhooks on network timeouts. To handle this safely:
1. **Event-level deduplication**: Each webhook creates an `eventKey` (`event.data.id` or `${event}_${reference}`). Duplicate requests are acknowledged with `200 OK` immediately without re-running handlers.
2. **Repayment deduplication**: `charge.success` checks if `reference` already exists in `repayments` before recording.

