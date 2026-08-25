export const config = {
  port: process.env.PORT || 8888,
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    baseUrl: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
  },
};

