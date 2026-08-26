import { JSONFilePreset } from 'lowdb/node';

const defaultData = {
  borrowers: [],
  loans: [],
  repayments: [],
  webhooks: [],
};

const lowdb = await JSONFilePreset('db.json', defaultData);

export const db = {
  data: lowdb.data,
  write: () => lowdb.write(),
  borrowers: {
    get: (id) => lowdb.data.borrowers.find((borrower) => borrower.id === id),
    getByReference: (reference) =>
      lowdb.data.borrowers.find((borrower) => borrower.reference === reference),
    getByAuthCode: (authCode) =>
      lowdb.data.borrowers.find((borrower) => borrower.authCode === authCode),
    getByEmail: (email) =>
      lowdb.data.borrowers.find((borrower) => borrower.email === email),
    findBorrower: ({ reference, id, authCode, email } = {}) => {
      if (reference) {
        const byRef = lowdb.data.borrowers.find(
          (borrower) => borrower.reference === reference
        );
        if (byRef) return byRef;
      }
      if (id) {
        const byId = lowdb.data.borrowers.find(
          (borrower) => borrower.id === id
        );
        if (byId) return byId;
      }
      if (authCode) {
        const byAuth = lowdb.data.borrowers.find(
          (borrower) => borrower.authCode === authCode
        );
        if (byAuth) return byAuth;
      }
      if (email) {
        const byEmail = lowdb.data.borrowers.find(
          (borrower) => borrower.email === email
        );
        if (byEmail) return byEmail;
      }
      return undefined;
    },
    getAll: () => lowdb.data.borrowers,
    set: async (id, data) => {
      const index = lowdb.data.borrowers.findIndex(
        (borrower) => borrower.id === id
      );
      if (index >= 0) {
        lowdb.data.borrowers[index] = data;
      } else {
        lowdb.data.borrowers.push(data);
      }
      await lowdb.write();
    },
    has: (id) => lowdb.data.borrowers.some((borrower) => borrower.id === id),
  },
  loans: {
    get: (idOrBorrowerId) =>
      lowdb.data.loans.find(
        (loan) =>
          loan.id === idOrBorrowerId || loan.borrowerId === idOrBorrowerId
      ),
    getAll: () => lowdb.data.loans,
    set: async (id, data) => {
      const index = lowdb.data.loans.findIndex((loan) => loan.id === id);
      if (index >= 0) {
        lowdb.data.loans[index] = data;
      } else {
        lowdb.data.loans.push(data);
      }
      await lowdb.write();
    },
    has: (idOrBorrowerId) =>
      lowdb.data.loans.some(
        (loan) =>
          loan.id === idOrBorrowerId || loan.borrowerId === idOrBorrowerId
      ),
  },
  repayments: {
    get: (reference) =>
      lowdb.data.repayments.find(
        (repayment) => repayment.reference === reference
      ),
    getAll: () => lowdb.data.repayments,
    set: async (reference, data) => {
      const index = lowdb.data.repayments.findIndex(
        (repayment) => repayment.reference === reference
      );
      if (index >= 0) {
        lowdb.data.repayments[index] = data;
      } else {
        lowdb.data.repayments.push(data);
      }
      await lowdb.write();
    },
    has: (reference) =>
      lowdb.data.repayments.some(
        (repayment) => repayment.reference === reference
      ),
  },
  webhooks: {
    getAll: () => lowdb.data.webhooks || [],
    hasEvent: (eventKey) =>
      (lowdb.data.webhooks || []).some((webhook) => webhook.eventKey === eventKey),
    getByEventKey: (eventKey) =>
      (lowdb.data.webhooks || []).find((webhook) => webhook.eventKey === eventKey),
    getByIdOrEventKey: (idOrKey) =>
      (lowdb.data.webhooks || []).find(
        (webhook) => webhook.id === idOrKey || webhook.eventKey === idOrKey
      ),
    getLatest: () => {
      const wh = lowdb.data.webhooks || [];
      return wh.length > 0 ? wh[wh.length - 1] : null;
    },
    add: async (webhookData) => {
      if (!lowdb.data.webhooks) {
        lowdb.data.webhooks = [];
      }
      lowdb.data.webhooks.push(webhookData);
      await lowdb.write();
    },
    logReplay: async (id, replayInfo) => {
      const item = (lowdb.data.webhooks || []).find((w) => w.id === id);
      if (item) {
        item.replays = item.replays || [];
        item.replays.push(replayInfo);
        await lowdb.write();
      }
    },
  },
};