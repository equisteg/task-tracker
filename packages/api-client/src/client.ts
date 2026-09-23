import { Task, User, Company, MerchantBankSettlement, PaymentTransaction } from '@product/shared-types';

export class ProductApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string = 'http://localhost:4000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  // Tasks
  async getTasks(): Promise<Task[]> {
    return this.request<Task[]>('/api/tasks');
  }

  async createTask(task: Partial<Task>): Promise<Task> {
    return this.request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(task)
    });
  }

  // Payments & Bank Details
  async getBankSettlementDetails(): Promise<MerchantBankSettlement> {
    return this.request<MerchantBankSettlement>('/api/payments/settlement');
  }

  async updateBankSettlementDetails(details: Partial<MerchantBankSettlement>): Promise<MerchantBankSettlement> {
    return this.request<MerchantBankSettlement>('/api/payments/settlement', {
      method: 'POST',
      body: JSON.stringify(details)
    });
  }

  async processPayment(payload: {
    tenantId: string;
    amount: number;
    cycle: string;
    seats: number;
    paymentMethod: string;
    bankReferenceNumber?: string;
  }): Promise<PaymentTransaction> {
    return this.request<PaymentTransaction>('/api/payments/checkout', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
}
