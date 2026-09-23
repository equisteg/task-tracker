/**
 * Merchant Bank Account & Settlement Configuration
 * Funds collected from subscription payments are settled into this verified account.
 */
export interface MerchantBankSettlement {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  confirmAccountNumber?: string;
  routingOrIfsc: string;
  swiftBic?: string;
  country: string;
  currency: string;
  payoutSchedule: 'daily' | 'weekly' | 'monthly';
  stripePublishableKey?: string;
  stripeSecretKey?: string;
  razorpayKeyId?: string;
  isVerified: boolean;
  updatedAt: string;
}

export type BillingCycle = 'monthly' | 'yearly';

export interface SubscriptionPlan {
  id: string;
  name: string;
  ratePerUser: number; // $1/user/mo or $10/user/yr
  cycle: BillingCycle;
  seats: number;
  totalPrice: number;
}

export interface PaymentTransaction {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  seats: number;
  cycle: BillingCycle;
  paymentMethod: 'stripe_card' | 'bank_wire_transfer' | 'razorpay' | 'license_key';
  bankReferenceNumber?: string;
  status: 'succeeded' | 'pending_verification' | 'failed';
  timestamp: string;
  settlementAccount: string;
}
