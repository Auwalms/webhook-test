try {
  process.loadEnvFile?.();
} catch {
  // .env file not present in production (Railway/Render injects variables directly into process.env)
}

export const config = {
  port: process.env.PORT || 8888,
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    baseUrl: process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co',
  },
  webhook: {
    failAttempts: parseInt(process.env.FAIL_WEBHOOK_ATTEMPTS || '0', 10),
  },
};
