import { assert, integer } from './model.ts';
// V1 forms support currencies with two decimal places (USD/EUR).
// Parsing never multiplies a binary floating-point decimal amount.
export function parseAmountMinor(text: string, signed = false): number {
  const value = text.trim().replace(',', '.');
  assert((signed ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/).test(value), 'Usa un monto con hasta dos decimales');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const digits = whole + fraction.padEnd(2, '0');
  const result = integer(Number(digits));
  return negative ? -result : result;
}
export function formatAmountMinor(value: number, currency: string): string {
  integer(value);
  const absolute = Math.abs(value).toString().padStart(3, '0');
  return `${currency} ${value < 0 ? '-' : ''}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}
