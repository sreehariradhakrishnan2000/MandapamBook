/**
 * Fields a gateway's webhook may carry about the customer that we have no reason to keep:
 * contact details, names, addresses, UPI IDs and card or bank details. Payment ids,
 * amounts, statuses, methods and error codes stay, because that is what debugging needs.
 */
const PERSONAL_KEYS = new Set([
  'email',
  'contact',
  'phone',
  'customer_email',
  'customer_phone',
  'name',
  'vpa',
  'upi',
  'address',
  'billing_address',
  'shipping_address',
  'customer_details',
  'card',
  'card_id',
  'token_id',
  'bank_account',
  'acquirer_data',
]);

/** A deep copy of a gateway payload with the personal fields above removed. */
export function withoutPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPersonalData);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PERSONAL_KEYS.has(key))
      .map(([key, v]) => [key, withoutPersonalData(v)]),
  );
}
