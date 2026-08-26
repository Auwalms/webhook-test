# webhook-test

A minimal Express service that exercises Paystack's Direct Debit APIs: mandate setup, webhook handling, and recurring repayment charges. 

It surfaced a real, reproducible bug in `paystack-cli`'s local webhook testing flow along the way. That bug is now the subject of [PR #24](https://github.com/PaystackOSS/paystack-cli/pull/24) against the official CLI, open and awaiting review.

**Live URL:** [https://webhook-test-production-c88d.up.railway.app](https://webhook-test-production-c88d.up.railway.app)

## Why this gap, over the alternatives

The full assessment audited Documentation, API Reference, and SDK/CLI tooling, and ranked several gaps. This build addresses the CLI's broken local webhook testing specifically because it's the only ranked gap directly fixable with third-party code:

- **International fee/FX settlement uncertainty** (top-ranked by impact) can't be reliably solved client-side. The real settlement rate isn't knowable at charge time; only Paystack has that data at settlement.
- **No native React Native SDK** is a real, legitimate gap, but building a native SDK replacement isn't feasible in a one-week solo build.
- **Webhook delivery visibility and retrigger** requires access to Paystack's own internal delivery logs, which no public API currently exposes.
- **`paystack-cli`'s `webhook listen` failing outright** is the one gap where a developer, working alone with only public tools and test API keys, can both prove the problem and fix it.

## The problem, verified directly

Running the documented command:

```
paystack webhook listen --forward localhost:8888/webhooks/listen --domain test
```

fails immediately:

```
Error: spawn Unknown system error -86
```

This isn't an isolated environment issue. [Issue #22](https://github.com/PaystackOSS/paystack-cli/issues/22) on the official repo reports the same error class (`-86`/`-88`), filed June 2024, open and unaddressed for over two years at the time of this assessment.

**Actual testing sequence for this build**: since the CLI's `webhook listen` didn't work, this app was tested against real Paystack webhook deliveries using a manually configured `ngrok` tunnel (`ngrok http 8888`, with the resulting URL set directly on the dashboard), not the CLI. The CLI bug was hit and diagnosed independently, while trying to use the officially documented path.

## The root-cause fix: PR #24

Rather than build a separate workaround tool around the broken CLI, the root cause was fixed directly upstream. [PR #24](https://github.com/PaystackOSS/paystack-cli/pull/24) replaces the CLI's legacy `ngrok` dependency with Cloudflare Tunnel, removing the third-party signup and `NGROK_AUTH_TOKEN` requirement entirely. Developers will be able to run `webhook listen` with zero external signup once merged.

The PR also references two additional open issues ([#2](https://github.com/PaystackOSS/paystack-cli/issues/2), [#3](https://github.com/PaystackOSS/paystack-cli/issues/3)) affected by the same legacy dependency.

**Status: Open, awaiting maintainer review.** Not yet merged. Referenced here as evidence of the diagnosis and fix, not as a completed dependency of this app.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Configure environment:
   ```
   cp .env.example .env
   ```
   Add your Paystack test secret key to `.env`:
   ```
   PAYSTACK_SECRET_KEY=sk_test_xxx
   PAYSTACK_BASE_URL=https://api.paystack.co
   PORT=8888
   FAIL_WEBHOOK_ATTEMPTS=0
   ```
3. Start the server:
   ```
   npm run dev
   ```

## How it works

1. **Onboard Borrower**: `POST /loans/onboard` registers a borrower and creates a loan in `PENDING_MANDATE` status.
2. **Initialize Mandate**: `POST /mandates/initialize` calls Paystack's authorization endpoint and returns the authorization link for the customer.
3. **Webhook Processing**: `POST /webhooks/listen` verifies Paystack's HMAC SHA-512 signature, saves the event payload to `db.json`, and updates status:
   - `direct_debit.authorization.created` sets the loan to `APPROVED`.
   - `direct_debit.authorization.active` sets the loan to `ACTIVE` and saves the reusable `authCode`.
   - `charge.success` records the repayment.
4. **Charge Repayment**: `POST /mandates/charge-repayment` triggers a debit using the customer's stored `authCode`.

## Endpoints

| Method | Route                              | Description                                       |
| ------ | ----------------------------------- | -------------------------------------------------- |
| `POST` | `/loans/onboard`                    | Register a borrower and create loan                |
| `POST` | `/mandates/initialize`              | Initialize Direct Debit mandate with Paystack      |
| `POST` | `/mandates/charge-repayment`        | Charge repayment using stored authorization code   |
| `POST` | `/webhooks/listen`                  | Webhook receiver for Paystack events               |
| `GET`  | `/webhooks/logs`                    | View all saved webhook events                      |
| `GET`  | `/webhooks/retries`                 | View retry timing analysis and intervals           |
| `POST` | `/webhooks/replay/:eventId`         | Reprocess a specific logged event by ID            |
| `POST` | `/webhooks/replay/latest`           | Reprocess the most recently received event         |

## Self-service webhook replay

This directly answers a community-reported gap: developers currently have no way to see webhook delivery status or retrigger a delivery themselves, and have to contact Paystack support to request a repush. Full delivery history isn't exposed via any public API, so this app can't reach into Paystack's own logs, but it demonstrates the developer-facing pattern locally:

- `GET /webhooks/logs` and `GET /webhooks/retries` give a developer visibility into every event this app has received and how delivery attempts played out.
- `POST /webhooks/replay/:eventId` reprocesses one specific event from the local log, by its ID, without needing to contact anyone.
- `POST /webhooks/replay/latest` reprocesses the most recently received event, for quick, no-lookup retries during testing.

This is a proxy, not a replacement for Paystack exposing real delivery history and retrigger support on the dashboard, but it shows exactly what that developer experience should feel like.

## Testing with Postman

A complete Postman collection is included in `postman_collection.json`.

1. **Onboard Borrower & Loan**: saves `borrowerId` into collection variables.
2. **Initialize Mandate**: calls Paystack, captures `mandateReference`.
3. **Simulate Webhooks** (under `Webhooks (Paystack)`):
   - **`Webhook - Mandate Created`** sets the loan to `APPROVED`.
   - **`Webhook - Mandate Active`** sets the loan to `ACTIVE` and saves `authCode`.
   - The folder's pre-request script computes and attaches a valid `x-paystack-signature` header via HMAC SHA-512.
4. **Charge Repayment**: `POST /mandates/charge-repayment`.
5. **Charge Success Webhook**: run **`Webhook - Charge Success`**.
6. **Check Logs**: `GET /webhooks/logs` or `GET /webhooks/retries`.

## Testing real webhook delivery and retry timing

1. **Enable the deliberate-failure toggle** (`.env` or `x-fail-attempts: 2` header):
   ```
   FAIL_WEBHOOK_ATTEMPTS=2
   ```
   The listener responds `500` on the first 2 delivery attempts of any event, then `200` on attempt 3. This makes Paystack's real retry behavior observable.

2. **Expose the local server.** As documented, `paystack-cli`'s `webhook listen` is the intended path here, but see [The problem, verified directly](#the-problem-verified-directly) above. Until [PR #24](https://github.com/PaystackOSS/paystack-cli/pull/24) is merged, use a manual tunnel instead:
   ```
   ngrok http 8888
   ```
   Set the resulting URL as the dashboard's Test Webhook URL directly.

3. **Observe verified retry intervals:**
   ```
   curl http://localhost:8888/webhooks/retries
   ```
   Returns exact timestamps of each failed and successful attempt, and the actual elapsed time between retries.

## Known limitations

- Full delivery history and retrigger still require Paystack's own internal data. `/webhooks/replay` reprocesses what this app has already logged locally; it can't retrieve or resend anything this app never received in the first place.
- Not production-hardened. No database beyond `db.json`, no auth beyond the loan record itself.

## What I'd do next with more time

- See PR #24 through review and merge, and fix its issue cross-linking so #2, #3, and #22 formally auto-close.
- Add a reconciliation check against Paystack's `Verify Transaction` endpoint, so a developer can confirm a transaction's authoritative status against what was actually logged locally. This is a different guarantee than replay: it catches events that were never received at all, not just ones that need reprocessing.
- Run a structured accuracy test on AI-generated Paystack integration code against the OpenAPI spec, to quantify how often AI coding assistants hallucinate endpoints or parameters.

## Notes

- **Database**: Uses Lowdb to persist data to `db.json`.
- **Idempotency**: Webhook events check for previously processed event keys in `db.json` before processing, preventing duplicate handling on retries.

## Evidence referenced

- [`paystack-cli` issue #22](https://github.com/PaystackOSS/paystack-cli/issues/22): the pre-existing report matching this build's independently reproduced error.
- [PR #24](https://github.com/PaystackOSS/paystack-cli/pull/24): the root-cause fix submitted as part of this assessment.
- [PaystackOSS/openapi releases](https://github.com/PaystackOSS/openapi/releases): latest tag is `v1.0.0` (Sep 28, 2022) against 150 commits on `main`, referenced in the assessment's recommendations.