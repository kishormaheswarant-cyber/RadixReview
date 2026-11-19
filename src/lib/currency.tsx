import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'INR' | 'JPY' | 'CAD' | 'AUD' | 'SGD';

export interface CurrencyConfig {
  code: CurrencyCode;
  label: string;
  symbol: string;
  rateFromUsd: number;
  locale: string;
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: 'USD', label: 'USD — US Dollar', symbol: '$', rateFromUsd: 1, locale: 'en-US' },
  { code: 'EUR', label: 'EUR — Euro', symbol: '€', rateFromUsd: 0.92, locale: 'en-IE' },
  { code: 'GBP', label: 'GBP — British Pound', symbol: '£', rateFromUsd: 0.79, locale: 'en-GB' },
  { code: 'INR', label: 'INR — Indian Rupee', symbol: '₹', rateFromUsd: 84.2, locale: 'en-IN' },
  { code: 'JPY', label: 'JPY — Japanese Yen', symbol: '¥', rateFromUsd: 153.5, locale: 'ja-JP' },
  { code: 'CAD', label: 'CAD — Canadian Dollar', symbol: 'CA$', rateFromUsd: 1.39, locale: 'en-CA' },
  { code: 'AUD', label: 'AUD — Australian Dollar', symbol: 'A$', rateFromUsd: 1.53, locale: 'en-AU' },
  { code: 'SGD', label: 'SGD — Singapore Dollar', symbol: 'S$', rateFromUsd: 1.34, locale: 'en-SG' },
];

const CURRENCY_STORAGE_KEY = 'radix_currency_v1';

export function getCurrencyConfig(code: CurrencyCode): CurrencyConfig {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code) || SUPPORTED_CURRENCIES[0];
}

export function formatUsdCentsInCurrency(usdCents: number, code: CurrencyCode): string {
  const cfg = getCurrencyConfig(code);
  const convertedMajor = (usdCents / 100) * cfg.rateFromUsd;
  const fractionDigits = code === 'JPY' ? 0 : 2;
  return new Intl.NumberFormat(cfg.locale, {
    style: 'currency',
    currency: cfg.code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(convertedMajor);
}

interface CurrencyContextValue {
  currency: CurrencyCode;
  currencyConfig: CurrencyConfig;
  setCurrency: (code: CurrencyCode) => void;
  formatPrice: (usdCents: number) => string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    try {
      const saved = localStorage.getItem(CURRENCY_STORAGE_KEY) as CurrencyCode | null;
      if (saved && SUPPORTED_CURRENCIES.some((c) => c.code === saved)) {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'USD';
  });

  useEffect(() => {
    try {
      localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
    } catch {
      // ignore
    }
  }, [currency]);

  const setCurrency = (code: CurrencyCode) => {
    if (SUPPORTED_CURRENCIES.some((c) => c.code === code)) {
      setCurrencyState(code);
    }
  };

  const currencyConfig = getCurrencyConfig(currency);
  const formatPrice = (usdCents: number) => formatUsdCentsInCurrency(usdCents, currency);

  return (
    <CurrencyContext.Provider value={{ currency, currencyConfig, setCurrency, formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    return {
      currency: 'USD',
      currencyConfig: SUPPORTED_CURRENCIES[0],
      setCurrency: () => {},
      formatPrice: (usdCents: number) => formatUsdCentsInCurrency(usdCents, 'USD'),
    };
  }
  return ctx;
}
