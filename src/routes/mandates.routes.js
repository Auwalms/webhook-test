import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

export const mandatesRouter = Router();
const baseUrl = config.paystack.baseUrl;

mandatesRouter.post('/initialize', async (req, res) => {
  const { borrowerId, callbackUrl } = req.body;
  const borrower = db.borrowers.get(borrowerId);

  if (!borrower) {
    return res.status(404).json({ error: 'Borrower not found' });
  }

  try {
    const response = await fetch(`${baseUrl}/customer/authorization/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: borrower.email,
        channel: 'direct_debit',
        callback_url: callbackUrl ?? 'https://google.com',
        account: {
        number: borrower.bankAccountNumber,
        bank_code: borrower.bankCode
      },
      address: {
        state: borrower.address.state,
        city: borrower.address.city,
        street: borrower.address.street
      }
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'Failed to initialize mandate',
        details: data,
      });
    }

    if (data.data?.reference) {
      borrower.reference = data.data.reference;
      await db.write();
    }

    return res.status(response.status).json(data);
   
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

mandatesRouter.post('/charge-repayment', async (req, res) => {
  const { borrowerId, amount } = req.body;
  const borrower = db.borrowers.get(borrowerId);

  if (!borrower || !borrower.authCode) {
    return res.status(400).json({ error: 'No active authorization code found for this borrower' });
  }

  try {
    const reference = `repay_${randomUUID()}`;
    const response = await fetch(`${baseUrl}/transaction/charge_authorization`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: borrower.email,
        amount: amount * 100 ?? borrower.debitAmount * 100,
        authorization_code: borrower.authCode,
        reference,
        currency: 'NGN',
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});