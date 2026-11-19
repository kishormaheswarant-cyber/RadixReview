import { SUPPORTED_CURRENCIES, useCurrency, type CurrencyCode } from '../lib/currency.tsx';

interface CurrencySelectProps {
  compact?: boolean;
  className?: string;
}

export function CurrencySelect({ compact = false, className = '' }: CurrencySelectProps) {
  const { currency, setCurrency } = useCurrency();

  return (
    <select
      value={currency}
      onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
      aria-label="Display currency"
      className={`px-3 py-2 text-sm bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C] font-medium text-[#111315] shrink-0 ${className}`}
    >
      {SUPPORTED_CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {compact ? `${c.code} (${c.symbol})` : `${c.code} (${c.symbol}) — ${c.label.split('— ')[1]}`}
        </option>
      ))}
    </select>
  );
}
