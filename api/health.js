'use strict';

const { endpoint } = require('./_lib/http');
const { publicBillingInfo } = require('./_lib/billing');
const { platformSmtpConfig } = require('./_lib/mailer');

module.exports = endpoint({
  get: {
    method: 'GET',
    handler: async () => {
      const missing = [];
      if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
      if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) missing.push('JWT_SECRET');
      if (!platformSmtpConfig()) missing.push('SMTP_HOST/SMTP_USER/SMTP_PASS');
      // Razorpay is optional: without it, online payment is hidden and trials / license keys / bank transfers still work.
      const optionalMissing = [];
      if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) optionalMissing.push('RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET');
      return {
        service: 'task-tracker-cloud',
        cloud: true,
        configured: missing.length === 0,
        missing,
        optionalMissing,
        billing: publicBillingInfo(),
      };
    },
  },
});
