import { Router, Request, Response } from 'express';

export const paymentsRouter = Router();

// In-memory / persistent merchant bank settlement store
let merchantBankSettlement = {
  accountHolderName: process.env.BANK_ACCOUNT_HOLDER || 'Platform Merchant Operations',
  bankName: process.env.BANK_NAME || 'Silicon Valley Bank / Standard Chartered',
  accountNumber: process.env.BANK_ACCOUNT_NUMBER || '00112233445566',
  routingOrIfsc: process.env.BANK_ROUTING_OR_IFSC || 'SVBLUS33 / HDFC0001234',
  swiftBic: process.env.BANK_SWIFT_BIC || 'SVBLUS33XXX',
  country: process.env.BANK_SETTLEMENT_COUNTRY || 'US',
  currency: process.env.BANK_SETTLEMENT_CURRENCY || 'USD',
  payoutSchedule: 'daily',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  isVerified: true,
  updatedAt: new Date().toISOString()
};

const transactions: any[] = [];

// 1. Get Merchant Bank Settlement Details
paymentsRouter.get('/settlement', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: merchantBankSettlement,
    notice: 'Funds from all organization subscriptions ($1/user/mo or $10/user/yr) will be settled into this bank account.'
  });
});

// 2. Update Merchant Bank Settlement Details
paymentsRouter.post('/settlement', (req: Request, res: Response) => {
  const {
    accountHolderName,
    bankName,
    accountNumber,
    routingOrIfsc,
    swiftBic,
    country,
    currency,
    payoutSchedule,
    stripePublishableKey,
    stripeSecretKey,
    razorpayKeyId
  } = req.body;

  if (!accountHolderName || !bankName || !accountNumber || !routingOrIfsc) {
    return res.status(400).json({
      success: false,
      error: 'Missing required bank fields: Account Holder, Bank Name, Account Number, and Routing/IFSC are mandatory.'
    });
  }

  merchantBankSettlement = {
    accountHolderName,
    bankName,
    accountNumber,
    routingOrIfsc,
    swiftBic: swiftBic || merchantBankSettlement.swiftBic,
    country: country || merchantBankSettlement.country,
    currency: currency || merchantBankSettlement.currency,
    payoutSchedule: payoutSchedule || merchantBankSettlement.payoutSchedule,
    stripePublishableKey: stripePublishableKey || merchantBankSettlement.stripePublishableKey,
    razorpayKeyId: razorpayKeyId || merchantBankSettlement.razorpayKeyId,
    isVerified: true,
    updatedAt: new Date().toISOString()
  };

  res.json({
    success: true,
    message: 'Merchant receiving bank account updated successfully. Subscription funds are routed directly here.',
    data: merchantBankSettlement
  });
});

// 3. Process Checkout Payment (Stripe / Bank Wire / Card)
paymentsRouter.post('/checkout', (req: Request, res: Response) => {
  const { tenantId, amount, seats, cycle, paymentMethod, bankReferenceNumber } = req.body;

  const txId = 'TXN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  const tx = {
    id: txId,
    tenantId: tenantId || 'tenant_main',
    amount: Number(amount) || 5,
    currency: merchantBankSettlement.currency,
    seats: Number(seats) || 5,
    cycle: cycle || 'monthly',
    paymentMethod: paymentMethod || 'stripe_card',
    bankReferenceNumber: bankReferenceNumber || null,
    status: paymentMethod === 'bank_wire_transfer' ? 'pending_verification' : 'succeeded',
    settlementAccount: `${merchantBankSettlement.bankName} (Acct: ${merchantBankSettlement.accountNumber.slice(-4)})`,
    timestamp: new Date().toISOString()
  };

  transactions.unshift(tx);

  res.json({
    success: true,
    transaction: tx,
    message: paymentMethod === 'bank_wire_transfer'
      ? `Wire transfer receipt registered. Ref: ${bankReferenceNumber}. Payout will settle to ${merchantBankSettlement.accountHolderName}.`
      : `Payment of $${tx.amount}.00 received and routed to merchant settlement account.`
  });
});

// 4. List Transactions
paymentsRouter.get('/transactions', (_req: Request, res: Response) => {
  res.json({ success: true, count: transactions.length, data: transactions });
});
