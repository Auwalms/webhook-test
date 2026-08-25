import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';

export const loansRouter = Router();


loansRouter.post('/onboard', async (req, res) => {
  const { email, firstName, lastName, phone, loanAmount, address, bankAccountNumber, bankCode, debitAmount, debitFrequency } = req.body;

  if (!email || !loanAmount) {
    return res.status(400).json({ error: 'Email and loan amount are required' });
  }

  const borrowerId = randomUUID();
  const loanId = randomUUID();

  const borrower = {
    id: borrowerId,
    email,
    firstName,
    lastName,
    phone,
    address,
    bankAccountNumber,
    bankCode,
    debitAmount,
    debitFrequency,
    authCode: null, 
    reference: null,
  };

  const loan = {
    id: loanId,
    borrowerId,
    amount: loanAmount,
    status: 'PENDING_MANDATE',
    createdAt: new Date().toISOString(),
  };

  await db.borrowers.set(borrowerId, borrower);
  await db.loans.set(loanId, loan);

  return res.status(201).json({ borrower, loan });
});