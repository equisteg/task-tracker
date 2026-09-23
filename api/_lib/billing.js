'use strict';

const crypto = require('crypto');

function pricing() {
  return {
    currency: (process.env.BILLING_CURRENCY || 'USD').toUpperCase(),
    monthly: Number(process.env.PRICE_PER_USER_MONTHLY || 1),
    yearly: Number(process.env.PRICE_PER_USER_YEARLY || 10),
  };
}

function normalizePlan(seats, cycle) {
  const s = Math.floor(Number(seats));
  if (!Number.isFinite(s) || s < 1 || s > 5000) {
    throw Object.assign(new Error('Seats must be between 1 and 5000.'), { status: 400 });
  }
  const c = cycle === 'yearly' ? 'yearly' : 'monthly';
  return { seats: s, cycle: c };
}

// Amount in the currency's smallest unit (cents / paise), as Razorpay expects.
function quote(seats, cycle) {
  const p = pricing();
  const plan = normalizePlan(seats, cycle);
  const perUser = plan.cycle === 'yearly' ? p.yearly : p.monthly;
  return { ...plan, currency: p.currency, perUser, amount: Math.round(plan.seats * perUser * 100) };
}

function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

async function createRazorpayOrder({ amount, currency, receipt, notes }) {
  if (!razorpayConfigured()) {
    throw Object.assign(new Error('Online payments are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).'), { status: 500, code: 'PAYMENTS_NOT_CONFIGURED' });
  }
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency, receipt: String(receipt).slice(0, 40), notes }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.description) || `Razorpay order creation failed (${res.status}).`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return body;
}

// https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/#verify-payment-signature
function verifyRazorpaySignature(orderId, paymentId, signature) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function periodEnd(cycle, from = new Date()) {
  const d = new Date(from);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function publicBillingInfo() {
  const p = pricing();
  return {
    currency: p.currency,
    pricePerUserMonthly: p.monthly,
    pricePerUserYearly: p.yearly,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
    onlinePaymentsEnabled: razorpayConfigured(),
    bank: {
      accountHolder: process.env.BANK_ACCOUNT_HOLDER || null,
      bankName: process.env.BANK_NAME || null,
      accountNumber: process.env.BANK_ACCOUNT_NUMBER || null,
      routingOrIfsc: process.env.BANK_ROUTING_OR_IFSC || null,
    },
  };
}

module.exports = {
  pricing,
  quote,
  normalizePlan,
  createRazorpayOrder,
  verifyRazorpaySignature,
  razorpayConfigured,
  periodEnd,
  publicBillingInfo,
};
