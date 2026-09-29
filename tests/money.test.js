import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatMoney, toDecimalString, allocate, splitEvenly } from '../js/money.js';

test('parseAmount handles the formats people actually type', () => {
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('12.56'), 1256);
  assert.equal(parseAmount('1,234.56'), 123456);
  assert.equal(parseAmount(' ₹ 80 '), 8000);
  assert.equal(parseAmount('$1,000'), 100000);
  assert.equal(parseAmount(0), 0);
  assert.equal(parseAmount(12.34), 1234);
});

test('parseAmount reads European-style separators', () => {
  // With both separators present the rightmost one is the decimal point.
  assert.equal(parseAmount('1.234,50'), 123450);
  assert.equal(parseAmount('1,234.50'), 123450);
  // A lone comma with 1-2 trailing digits reads as a decimal comma...
  assert.equal(parseAmount('1,5'), 150);
  assert.equal(parseAmount('1,50'), 150);
  // ...but with a full 3-digit group it is a thousands separator.
  assert.equal(parseAmount('1,234'), 123400);
  // A lone dot is always the decimal point. '1.234' is truly ambiguous, and in
  // an English-language input a decimal reading surprises fewer people; it
  // rounds to the currency's precision like any other decimal.
  assert.equal(parseAmount('1.234'), 123);
});

test('parseAmount rejects junk instead of silently returning zero', () => {
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('   '), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(undefined), null);
  assert.equal(parseAmount(NaN), null);
  assert.equal(parseAmount(Infinity), null);
});

test('zero-decimal currencies keep whole units', () => {
  assert.equal(parseAmount('500', 'JPY'), 500);
  assert.equal(toDecimalString(500, 'JPY'), '500');
});

test('toDecimalString pads correctly around zero', () => {
  assert.equal(toDecimalString(5), '0.05');
  assert.equal(toDecimalString(50), '0.50');
  assert.equal(toDecimalString(0), '0.00');
  assert.equal(toDecimalString(-5), '-0.05');
  assert.equal(toDecimalString(123456), '1234.56');
});

test('formatMoney renders sign and symbol', () => {
  const inr = { code: 'INR', symbol: '₹' };
  assert.equal(formatMoney(133400, inr), '₹1,334.00');
  assert.equal(formatMoney(-5000, inr), '-₹50.00');
  assert.equal(formatMoney(5000, inr, { signed: true }), '+₹50.00');
  assert.equal(formatMoney(5000, inr, { omitSymbol: true }), '50.00');
});

test('allocate never loses or invents a unit', () => {
  assert.deepEqual(allocate(1000, [1, 1, 1]), [334, 333, 333]);
  assert.deepEqual(allocate(100, [1, 2, 1]), [25, 50, 25]);
  assert.deepEqual(allocate(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(allocate(0, [1, 1]), [0, 0]);
  assert.deepEqual(allocate(7, [1]), [7]);
});

test('allocate handles negatives and degenerate weights', () => {
  assert.deepEqual(allocate(-1000, [1, 1, 1]), [-334, -333, -333]);
  assert.deepEqual(allocate(100, [0, 0]), [50, 50], 'all-zero weights fall back to an even split');
  assert.deepEqual(allocate(100, []), []);
});

test('allocate sums to the total for every shape (property check)', () => {
  for (let total = 0; total < 400; total += 7) {
    for (let n = 1; n <= 9; n += 1) {
      const weights = Array.from({ length: n }, (_, i) => (i * 7 + 3) % 11);
      const parts = allocate(total, weights);
      assert.equal(parts.reduce((a, b) => a + b, 0), total, `total=${total} n=${n}`);
      assert.ok(parts.every(Number.isInteger), 'every part is an integer');
    }
  }
});

test('splitEvenly spreads the remainder one unit at a time', () => {
  const parts = splitEvenly(1001, 3);
  assert.deepEqual(parts, [334, 334, 333]);
  assert.equal(Math.max(...parts) - Math.min(...parts), 1, 'nobody pays more than 1 unit extra');
});
