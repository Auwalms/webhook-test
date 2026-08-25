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
FAIL_WEBHOOK_ATTEMPTS=0
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
| `GET` | `/webhooks/retries` | View retry timing analysis and intervals |

## Testing with Postman

A complete Postman collection is included in `postman_collection.json`. Import it into Postman and run the requests in order:

1. **Onboard Borrower & Loan**: Creates borrower and loan. The test script automatically saves `borrowerId` into collection variables.
2. **Initialize Mandate**: Calls Paystack and returns authorization URL. The test script automatically captures `mandateReference`.
3. **Simulate Webhooks** (under `Webhooks (Paystack)` folder):
   - Run **`Webhook - Mandate Created`**: Uses `mandateReference` to update loan to `APPROVED`.
   - Run **`Webhook - Mandate Active`**: Uses `mandateReference` to set loan to `ACTIVE` and saves `authCode`.
   - *Note*: The folder pre-request script computes and attaches the valid `x-paystack-signature` header automatically using HMAC SHA-512.
4. **Charge Repayment**: Calls `POST /mandates/charge-repayment` to charge the borrower using their active `authCode`.
5. **Charge Success Webhook**: Run **`Webhook - Charge Success`** to simulate Paystack's payment confirmation and record the repayment.
6. **Check Logs**: Run **`Get Webhook Logs`** (`GET /webhooks/logs`) or **`Get Retry Timing Analysis`** (`GET /webhooks/retries`).

## Testing Webhook Retries & Paystack CLI

To test Paystack's actual webhook retry intervals against documented values:

### 1. Enable Deliberate Failure Toggle
In your `.env` file (or via the `x-fail-attempts: 2` request header):
```ini
FAIL_WEBHOOK_ATTEMPTS=2
```
This tells the webhook listener to deliberately respond with `500 Internal Server Error` on the first 2 delivery attempts of any webhook event before succeeding (`200 OK`) on attempt 3.

### 2. Forward Events with Paystack CLI or Tunnel
Using `paystack-cli`:
```bash
paystack listen --forward-to http://localhost:8888/webhooks/listen
```

### 3. Observe Verified Retry Intervals
Check the captured retry intervals:
```bash
curl http://localhost:8888/webhooks/retries
```

This returns an analysis showing:
- Exact timestamps of each failed and successful attempt
- Actual time elapsed (in seconds) between retry 1, retry 2, etc.

## Notes

- **Database**: Uses Lowdb to persist data to `db.json`.
- **Idempotency**: Webhook events check for previously processed event keys in `db.json` before running to prevent duplicate processing on retries.
