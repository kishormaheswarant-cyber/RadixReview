import crypto from 'node:crypto';

export interface CardTokenizeInput {
  cardNumber: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  cardholderName: string;
}

export interface TokenizedCardResult {
  token: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
}

export function luhnCheck(rawDigits: string): boolean {
  const digits = rawDigits.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function detectCardBrand(digits: string): string {
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^6(?:011|5)/.test(digits)) return 'Discover';
  return 'Card';
}

export function tokenizeCard(input: CardTokenizeInput): TokenizedCardResult {
  const digits = input.cardNumber.replace(/\D/g, '');
  if (!luhnCheck(digits)) {
    throw new Error('Card number failed Luhn verification. Check the digits and try again.');
  }

  const brand = detectCardBrand(digits);
  const expectedCvcLength = brand === 'American Express' ? 4 : 3;
  const cvcClean = input.cvc.replace(/\D/g, '');
  if (cvcClean.length !== expectedCvcLength && cvcClean.length !== 3 && cvcClean.length !== 4) {
    throw new Error(`Invalid security code. Expected ${expectedCvcLength} digits.`);
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const yearNormalized = input.expYear < 100 ? 2000 + input.expYear : input.expYear;

  if (
    !Number.isInteger(input.expMonth) ||
    input.expMonth < 1 ||
    input.expMonth > 12 ||
    yearNormalized < currentYear ||
    (yearNormalized === currentYear && input.expMonth < currentMonth)
  ) {
    throw new Error('Card expiration date is invalid or expired.');
  }

  const cardholderName = input.cardholderName.trim();
  if (cardholderName.length < 2) {
    throw new Error('Cardholder name is required.');
  }

  const last4 = digits.slice(-4);
  const token = `tok_rdx_${crypto.randomBytes(16).toString('hex')}`;

  return {
    token,
    brand,
    last4,
    expMonth: input.expMonth,
    expYear: yearNormalized,
    cardholderName,
  };
}

export function computeOrderTotals(subtotalCents: number): {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
} {
  const shippingCents = subtotalCents >= 15000 || subtotalCents === 0 ? 0 : 1200;
  const taxCents = Math.round(subtotalCents * 0.0825);
  const totalCents = subtotalCents + shippingCents + taxCents;
  return { subtotalCents, shippingCents, taxCents, totalCents };
}

export function generateGatewayReference(): string {
  return `ch_rdx_${crypto.randomBytes(10).toString('hex')}`;
}
