import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

export const webhooksRouter = Router();

webhooksRouter.post('/listen', (req, res) => {
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

  res.sendStatus(200);

  switch (event.event) {
    case 'direct_debit.authorization.created': {
        const { authorization_code, metadata } = event.data;
        const borrowerId = metadata?.borrowerId;
        if (borrowerId && db.loans.has(borrowerId)) {
          const borrower = db.borrowers.get(borrowerId);
          const loan = db.loans.get(borrowerId);
          borrower.authCode = authorization_code;
          loan.status = "APPROVED";
          console.log(`[Mandate Created] Borrower: ${borrowerId}, Code: ${authorization_code}`);
        }
    
      break;
    }
    case 'direct_debit.authorization.active': {
        const { authorization_code, metadata } = event.data;
        const borrowerId = metadata?.borrowerId;
        if (borrowerId && db.loans.has(borrowerId)) {
          const borrower = db.borrowers.get(borrowerId);
          borrower.authCode ??= authorization_code;
          const loan = db.loans.get(borrowerId);
          loan.status = "ACTIVE";
          console.log(`[Mandate Activated] Borrower: ${borrowerId}, Code: ${authorization_code}`);
        }

      break;
    } 
    case 'charge.success': {
      const { authorization, metadata, reference, amount, paid_at } = event.data;
      const borrowerId = metadata?.borrowerId;

      if (borrowerId && db.loans.has(borrowerId)) {
        const borrower = db.borrowers.get(borrowerId);

        // Store reusable reusable mandate authorization code
        if (authorization?.authorization_code && authorization?.reusable) {
          borrower.authCode = authorization.authorization_code;
          borrower.mandateBank = authorization.bank;
          console.log(`[Repayment Successful] Borrower: ${borrowerId}, Code: ${borrower.authCode}`);
        }
      }

      db.repayments.set(reference, {
        reference,
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