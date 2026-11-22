/**
 * The one place that knows concrete payment providers. Everything else receives a
 * PaymentProvider. Switching gateways is an environment change: PAYMENT_PROVIDER=mock|razorpay.
 */
import type { Env } from '../../config/env.js';
import { MockPaymentProvider } from './mock/mock-provider.js';
import type { PaymentProvider } from './provider.js';
import { RazorpayProvider } from './razorpay/razorpay-provider.js';

export type PaymentEnv = Pick<
  Env,
  | 'PAYMENT_PROVIDER'
  | 'MOCK_PAYMENT_KEY_SECRET'
  | 'MOCK_PAYMENT_WEBHOOK_SECRET'
  | 'RAZORPAY_KEY_ID'
  | 'RAZORPAY_KEY_SECRET'
  | 'RAZORPAY_WEBHOOK_SECRET'
>;

export function createPaymentProvider(env: PaymentEnv): PaymentProvider {
  switch (env.PAYMENT_PROVIDER) {
    case 'mock':
      if (!env.MOCK_PAYMENT_KEY_SECRET || !env.MOCK_PAYMENT_WEBHOOK_SECRET) {
        throw new Error('mock payment secrets are not configured');
      }
      return new MockPaymentProvider(env.MOCK_PAYMENT_KEY_SECRET, env.MOCK_PAYMENT_WEBHOOK_SECRET);
    case 'razorpay':
      if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET) {
        throw new Error('Razorpay credentials are not configured');
      }
      return new RazorpayProvider({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
      });
  }
}

/** Narrow type guard used only by the mock checkout routes. */
export function asMockProvider(provider: PaymentProvider): MockPaymentProvider | null {
  return provider instanceof MockPaymentProvider ? provider : null;
}
