import { Router } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

export const webhooksRouter = Router();

const attemptTracker = new Map();

webhooksRouter.get('/logs', (req, res) => {
  return res.json(db.webhooks.getAll());
});

webhooksRouter.get('/retries', (req, res) => {
  const logs = db.webhooks.getAll();
  const grouped = {};

  for (const log of logs) {
    const key = log.eventKey || log.reference || log.id;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      attempt: log.attempt || 1,
      status: log.status || 'SUCCESS',
      receivedAt: log.receivedAt,
    });
  }

  const analysis = Object.entries(grouped).map(([eventKey, attempts]) => {
    const sorted = attempts.sort(
      (a, b) => new Date(a.receivedAt) - new Date(b.receivedAt)
    );
    const intervals = [];

    for (let i = 1; i < sorted.length; i++) {
      const diffMs =
        new Date(sorted[i].receivedAt) - new Date(sorted[i - 1].receivedAt);
      const diffSec = (diffMs / 1000).toFixed(2);
      intervals.push({
        fromAttempt: sorted[i - 1].attempt,
        toAttempt: sorted[i].attempt,
        intervalSeconds: Number(diffSec),
      });
    }

    return {
      eventKey,
      totalAttempts: sorted.length,
      history: sorted,
      intervals,
    };
  });

  return res.json(analysis);
});

webhooksRouter.post('/listen', async (req, res) => {
  const paystackSignature = req.headers['x-paystack-signature'];
  const rawBody = req.body;

  if (!paystackSignature) {
    return res.status(400).send('Missing signature');
  }

  const hash = createHmac('sha512', config.paystack.secretKey)
    .update(rawBody)
    .digest('hex');

  const isValid = timingSafeEqual(
    Buffer.from(hash, 'utf-8'),
    Buffer.from(paystackSignature, 'utf-8')
  );

  if (!isValid) {
    return res.status(400).send('Invalid signature');
  }

  const event = JSON.parse(rawBody.toString());

  const eventKey = event.data?.id
    ? `event_${event.data.id}`
    : `${event.event}_${event.data?.reference || ''}_${event.data?.authorization_code || ''}`;

  // Check failure threshold from env or request header/query
  const failThreshold =
    parseInt(req.headers['x-fail-attempts'] || req.query.failAttempts, 10) ||
    config.webhook.failAttempts ||
    0;

  const currentAttempt = (attemptTracker.get(eventKey) || 0) + 1;
  attemptTracker.set(eventKey, currentAttempt);

  // Deliberate failure simulation to observe webhook retry intervals
  if (currentAttempt <= failThreshold) {
    console.log(
      `[Retry Test] Failing attempt #${currentAttempt} for ${eventKey} (threshold: ${failThreshold}) at ${new Date().toISOString()}`
    );

    await db.webhooks.add({
      id: randomUUID(),
      eventKey,
      event: event.event,
      attempt: currentAttempt,
      status: 'FAILED_SIMULATED',
      reference: event.data?.reference || null,
      receivedAt: new Date().toISOString(),
      data: event.data,
    });

    return res.status(500).json({
      status: 'error',
      message: `Simulated failure for retry timing observation (attempt ${currentAttempt} of ${failThreshold})`,
      attempt: currentAttempt,
      timestamp: new Date().toISOString(),
    });
  }

  // Idempotency check: if this event was already processed successfully, acknowledge and skip
  if (eventKey && db.webhooks.hasEvent(eventKey)) {
    const existing = db.webhooks.getByEventKey(eventKey);
    if (existing && existing.status === 'SUCCESS') {
      console.log(`[Duplicate Webhook] Skipping already processed event: ${eventKey}`);
      return res.status(200).json({ status: 'ignored', message: 'Event already processed' });
    }
  }

  await db.webhooks.add({
    id: randomUUID(),
    eventKey,
    event: event.event,
    attempt: currentAttempt,
    status: 'SUCCESS',
    reference: event.data?.reference || null,
    data: event.data,
    receivedAt: new Date().toISOString(),
  });

  res.sendStatus(200);

  switch (event.event) {
    case 'direct_debit.authorization.created': {
      const { authorization_code, reference, bank, account_name, customer } =
        event.data;

      const borrower = db.borrowers.findBorrower({
        reference,
        authCode: authorization_code,
        email: customer?.email,
      });

      if (borrower) {
        borrower.authCode = authorization_code;
        if (bank) borrower.mandateBank = bank;
        if (account_name) borrower.accountName = account_name;
        if (customer?.code) borrower.customerCode = customer.code;

        const loan = db.loans.get(borrower.id);
        if (loan && loan.status !== 'APPROVED') {
          loan.status = 'APPROVED';
        }

        await db.write();
        console.log(
          `[Mandate Created] Borrower: ${borrower.id}, Reference: ${reference}, Code: ${authorization_code}`
        );
      } else {
        console.warn(
          `[Mandate Created] No matching borrower found for reference: ${reference}`
        );
      }
      break;
    }

    case 'direct_debit.authorization.active': {
      const { authorization_code, reference, bank, account_name, customer } =
        event.data;

      const borrower = db.borrowers.findBorrower({
        reference,
        authCode: authorization_code,
        email: customer?.email,
      });

      if (borrower) {
        borrower.authCode = authorization_code;
        if (bank) borrower.mandateBank = bank;
        if (account_name) borrower.accountName = account_name;
        if (customer?.code) borrower.customerCode = customer.code;

        const loan = db.loans.get(borrower.id);
        if (loan && loan.status !== 'ACTIVE') {
          loan.status = 'ACTIVE';
        }

        await db.write();
        console.log(
          `[Mandate Activated] Borrower: ${borrower.id}, Reference: ${reference}, Code: ${authorization_code}`
        );
      } else {
        console.warn(
          `[Mandate Activated] No matching borrower found for reference: ${reference}`
        );
      }
      break;
    }

    case 'charge.success': {
      const { authorization, reference, amount, paid_at, customer } =
        event.data;
      const authCode = authorization?.authorization_code;

      if (reference && db.repayments.has(reference)) {
        console.log(
          `[Duplicate Repayment] Skipping already recorded reference: ${reference}`
        );
        break;
      }

      const borrower = db.borrowers.findBorrower({
        authCode,
        email: customer?.email,
      });

      if (borrower) {
        if (authCode && authorization?.reusable) {
          borrower.authCode = authCode;
          borrower.mandateBank = authorization.bank;
          await db.write();
        }
        console.log(
          `[Repayment Successful] Borrower: ${borrower.id}, Reference: ${reference}, Amount: ${amount / 100}`
        );
      }

      await db.repayments.set(reference, {
        reference,
        borrowerId: borrower?.id || null,
        amount: amount / 100,
        status: 'PAID',
        processedAt: paid_at,
      });
      break;
    }

    default:
      console.log(`[Unhandled Event] ${event.event}`);
  }
});