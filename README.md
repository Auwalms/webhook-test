# webhook-test

A simple Express service to test Paystack Direct Debit mandate setup, webhook handling, and recurring repayment charges.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
```

Add your Paystack test secret key to `.env`:
```ini
PAYSTACK_SECRET_KEY=sk_test_xxx
PAYSTACK_BASE_URL=https://api.paystack.co
PORT=8888
```

3. Start the server:
```bash
npm run dev
```

## How It Works

1. **Onboard Borrower**: `POST /loans/onboard` registers a borrower and creates a loan in `PENDING_MANDATE` status.
2. **Initialize Mandate**: `POST /mandates/initialize` calls Paystack's authorization endpoint and returns the authorization link for the customer.
3. **Webhook Processing**: `POST /webhooks/listen` verifies Paystack's HMAC SHA-512 signature, saves the event payload to `db.json`, and updates status:
   - `direct_debit.authorization.created` updates loan status to `APPROVED`.
   - `direct_debit.authorization.active` updates loan status to `ACTIVE` and saves the reusable `authCode`.
   - `charge.success` records the repayment.
4. **Charge Repayment**: `POST /mandates/charge-repayment` triggers a debit using the customer's stored `authCode`.

## Endpoints

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/loans/onboard` | Register a borrower and create loan |
| `POST` | `/mandates/initialize` | Initialize Direct Debit mandate with Paystack |
| `POST` | `/mandates/charge-repayment` | Charge repayment using stored authorization code |
| `POST` | `/webhooks/listen` | Webhook receiver for Paystack events |
| `GET` | `/webhooks/logs` | View all saved webhook events |

## Testing

A complete Postman collection is included in `postman_collection.json`. Import it into Postman and run the requests in order:

1. **Onboard Borrower & Loan**: Creates borrower and loan. The test script automatically saves `borrowerId` into collection variables.
2. **Initialize Mandate**: Calls Paystack and returns authorization URL. The test script automatically captures `mandateReference`.
3. **Simulate Webhooks** (under `Webhooks (Paystack)` folder):
   - Run **`Webhook - Mandate Created`**: Uses `mandateReference` to update loan to `APPROVED`.
   - Run **`Webhook - Mandate Active`**: Uses `mandateReference` to set loan to `ACTIVE` and saves `authCode`.
   - *Note*: The folder pre-request script computes and attaches the valid `x-paystack-signature` header automatically using HMAC SHA-512.
4. **Charge Repayment**: Calls `POST /mandates/charge-repayment` to charge the borrower using their active `authCode`.
5. **Charge Success Webhook**: Run **`Webhook - Charge Success`** to simulate Paystack's payment confirmation and record the repayment.
6. **Check Logs**: Run **`Get Webhook Logs`** (`GET /webhooks/logs`) to view all recorded webhook events.

### Testing Live Webhooks with Ngrok

To receive live webhooks from Paystack instead of simulating:
1. Start an ngrok tunnel: `ngrok http 8888`
2. Add your ngrok URL (`https://your-subdomain.ngrok-free.app/webhooks/listen`) to your Paystack Dashboard under **Settings -> API Keys & Webhooks**.

## Notes

- **Database**: Uses Lowdb to persist data to `db.json`.
- **Idempotency**: Webhook events check for previously processed event keys in `db.json` before running to prevent duplicate processing on retries.
