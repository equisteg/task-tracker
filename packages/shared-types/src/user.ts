export type UserRole = 'Admin' | 'Lead' | 'TM' | 'Support' | 'Auditor';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  teamId: string;
  isFloatingSupport: boolean;
  skills: string[];
  avatar?: string;
}

export interface Team {
  id: string;
  name: string;
  leadId: string;
  desc: string;
  emblem?: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string;
  adminEmail?: string;
  isMasterVIP?: boolean;
  verifiedEmail?: string;
  plan: string;
  isUnlimited?: boolean;
  isPaid?: boolean;
  seats: number;
  billingCycle: 'monthly' | 'yearly';
  pricePerUser: number;
  licenseKey?: string;
  trialDaysLeft?: number;
  logo?: string | null;
  lastTransactionId?: string;
  paidAt?: string;
}
