import { Router } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

export const webhooksRouter = Router();

const attemptTracker = new Map();

export async function handleWebhookEvent(event, { isReplay = false } = {}) {
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
          `[${isReplay ? 'Replay ' : ''}Mandate Created] Borrower: ${borrower.id}, Reference: ${reference}, Code: ${authorization_code}`
        );

        return {
          success: true,
          action: 'mandate_created',
          borrowerId: borrower.id,
          loanId: loan?.id,
          loanStatus: loan?.status,
        };
      } else {
        console.warn(
          `[${isReplay ? 'Replay ' : ''}Mandate Created] No matching borrower found for reference: ${reference}`
        );
        return {
          success: false,
          error: `No matching borrower found for reference: ${reference}`,
        };
      }
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
          `[${isReplay ? 'Replay ' : ''}Mandate Activated] Borrower: ${borrower.id}, Reference: ${reference}, Code: ${authorization_code}`
        );

        return {
          success: true,
          action: 'mandate_activated',
          borrowerId: borrower.id,
          loanId: loan?.id,
          loanStatus: loan?.status,
        };
      } else {
        console.warn(
          `[${isReplay ? 'Replay ' : ''}Mandate Activated] No matching borrower found for reference: ${reference}`
        );
        return {
          success: false,
          error: `No matching borrower found for reference: ${reference}`,
        };
      }
    }

    case 'charge.success': {
      const { authorization, reference, amount, paid_at, customer } =
        event.data;
      const authCode = authorization?.authorization_code;

      if (!isReplay && reference && db.repayments.has(reference)) {
        console.log(
          `[Duplicate Repayment] Skipping already recorded reference: ${reference}`
        );
        return {
          success: true,
          action: 'repayment_already_recorded',
          reference,
        };
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
          `[${isReplay ? 'Replay ' : ''}Repayment Successful] Borrower: ${borrower.id}, Reference: ${reference}, Amount: ${amount / 100}`
        );
      }

      await db.repayments.set(reference, {
        reference,
        borrowerId: borrower?.id || null,
        amount: amount / 100,
        status: 'PAID',
        processedAt: paid_at,
      });

      return {
        success: true,
        action: 'repayment_recorded',
        reference,
        borrowerId: borrower?.id,
        amount: amount / 100,
      };
    }

    default:
      console.log(`[Unhandled Event] ${event.event}`);
      return {
        success: false,
        action: 'unhandled_event',
        event: event.event,
      };
  }
}

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

webhooksRouter.post('/replay/:id', async (req, res) => {
  const { id } = req.params;
  const webhookRecord = db.webhooks.getByIdOrEventKey(id);

  if (!webhookRecord) {
    return res.status(404).json({
      error: `Webhook record with ID or eventKey '${id}' not found.`,
    });
  }

  const result = await handleWebhookEvent(
    { event: webhookRecord.event, data: webhookRecord.data },
    { isReplay: true }
  );

  const replayLog = {
    replayedAt: new Date().toISOString(),
    result,
  };

  await db.webhooks.logReplay(webhookRecord.id, replayLog);

  return res.json({
    message: 'Webhook replayed successfully',
    event: webhookRecord.event,
    eventId: webhookRecord.id,
    eventKey: webhookRecord.eventKey,
    result,
  });
});

webhooksRouter.post('/replay-latest', async (req, res) => {
  const webhookRecord = db.webhooks.getLatest();

  if (!webhookRecord) {
    return res.status(404).json({
      error: 'No webhook records found to replay.',
    });
  }

  const result = await handleWebhookEvent(
    { event: webhookRecord.event, data: webhookRecord.data },
    { isReplay: true }
  );

  const replayLog = {
    replayedAt: new Date().toISOString(),
    result,
  };

  await db.webhooks.logReplay(webhookRecord.id, replayLog);

  return res.json({
    message: 'Latest webhook replayed successfully',
    event: webhookRecord.event,
    eventId: webhookRecord.id,
    eventKey: webhookRecord.eventKey,
    result,
  });
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

  const failThreshold =
    parseInt(req.headers['x-fail-attempts'] || req.query.failAttempts, 10) ||
    config.webhook.failAttempts ||
    0;

  const currentAttempt = (attemptTracker.get(eventKey) || 0) + 1;
  attemptTracker.set(eventKey, currentAttempt);

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

  await handleWebhookEvent(event);
});