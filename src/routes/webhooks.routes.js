import { Router } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

export const webhooksRouter = Router();

webhooksRouter.get('/logs', (req, res) => {
  return res.json(db.webhooks.getAll());
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

  if (eventKey && db.webhooks.hasEvent(eventKey)) {
    console.log(`[Duplicate Webhook] Skipping already processed event: ${eventKey}`);
    return res.status(200).json({ status: 'ignored', message: 'Event already processed' });
  }

  await db.webhooks.add({
    id: randomUUID(),
    eventKey,
    event: event.event,
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
        console.log(`[Duplicate Repayment] Skipping already recorded reference: ${reference}`);
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