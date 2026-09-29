/**
 * Money is stored everywhere as an integer number of minor units (paise, cents).
 * Never as a float. Every arithmetic path in the app goes through this module.
 */

export const CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
];

/** Currencies with no minor unit — amounts are whole numbers. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

export function decimalsFor(code) {
  return ZERO_DECIMAL.has(code) ? 0 : 2;
}

export function currencyByCode(code) {
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
}

/**
 * Parse user input ("1,234.56", "₹80", "12") into minor units.
 * Returns null when the input isn't a usable number, so callers can show a
 * validation error rather than silently treating garbage as zero.
 */
export function parseAmount(input, code = 'INR') {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 10 ** decimalsFor(code)) : null;
  }
  if (typeof input !== 'string') return null;

  // Strip currency symbols, spaces and thousands separators, keep digits/sign/point.
  const cleaned = input.trim().replace(/[^0-9.,\-]/g, '');
  if (!cleaned) return null;

  // If both separators appear, the rightmost one is the decimal point.
  let normalised = cleaned;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    normalised = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (lastComma > -1) {
    // A lone comma is a decimal separator only if it looks like one (1,5 / 1,50).
    const tail = cleaned.length - lastComma - 1;
    normalised = tail > 0 && tail <= 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  }

  const value = Number(normalised);
  if (!Number.isFinite(value)) return null;

  // Round half-away-from-zero so 0.005 -> 0.01 and -0.005 -> -0.01.
  const scaled = value * 10 ** decimalsFor(code);
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Minor units -> plain decimal string, no symbol. "133400" -> "1334.00" */
export function toDecimalString(minor, code = 'INR') {
  const d = decimalsFor(code);
  if (d === 0) return String(minor);
  const neg = minor < 0;
  const abs = Math.abs(minor).toString().padStart(d + 1, '0');
  const whole = abs.slice(0, -d);
  const frac = abs.slice(-d);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Minor units -> display string with symbol and grouping. */
export function formatMoney(minor, currency = { code: 'INR', symbol: '₹' }, opts = {}) {
  const { signed = false, omitSymbol = false } = opts;
  const code = currency.code || 'INR';
  const d = decimalsFor(code);
  const neg = minor < 0;
  const abs = Math.abs(minor);

  let body;
  try {
    body = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(abs / 10 ** d);
  } catch {
    body = toDecimalString(abs, code);
  }

  const sym = omitSymbol ? '' : currency.symbol || '';
  const sign = neg ? '-' : signed && minor > 0 ? '+' : '';
  return `${sign}${sym}${body}`;
}

/**
 * Split `total` into `weights.length` parts proportional to the weights, using
 * the largest-remainder method so the parts always sum to exactly `total`.
 *
 * Plain rounding does not have this property: 1000 / 3 rounds to 333 three
 * times over and loses a unit. Here the leftover units go to the entries with
 * the largest fractional remainders, ties broken by original index so the
 * result is deterministic.
 */
export function allocate(total, weights) {
  const n = weights.length;
  if (n === 0) return [];

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    // No meaningful weights: fall back to an even split of the total.
    return allocate(total, new Array(n).fill(1));
  }

  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  const exact = weights.map((w) => (absTotal * w) / totalWeight);
  const floors = exact.map(Math.floor);
  let remainder = absTotal - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => (b.frac - a.frac) || (a.index - b.index));

  const parts = floors.slice();
  for (let i = 0; i < remainder; i += 1) {
    parts[order[i % n].index] += 1;
  }

  return parts.map((p) => p * sign);
}

/** Even split — the common case, expressed through allocate for consistency. */
export function splitEvenly(total, n) {
  return allocate(total, new Array(n).fill(1));
}

export function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}
