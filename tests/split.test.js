import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSplit, seedParticipants, resolvePayers, PERCENT_SCALE } from '../js/split.js';

const ids = ['a', 'b', 'c'];
const totalOf = (owed) => Object.values(owed).reduce((x, y) => x + y, 0);

test('equal split divides and absorbs the remainder', () => {
  const r = resolveSplit(1000, 'equal', ids.map((memberId) => ({ memberId, value: 0 })));
  assert.ok(r.valid);
  assert.deepEqual(r.owed, { a: 334, b: 333, c: 333 });
  assert.equal(totalOf(r.owed), 1000);
});

test('exact split must add up to the total', () => {
  const ok = resolveSplit(1000, 'exact', [
    { memberId: 'a', value: 500 }, { memberId: 'b', value: 300 }, { memberId: 'c', value: 200 },
  ]);
  assert.ok(ok.valid);
  assert.equal(totalOf(ok.owed), 1000);

  const short = resolveSplit(1000, 'exact', [
    { memberId: 'a', value: 500 }, { memberId: 'b', value: 300 },
  ]);
  assert.equal(short.valid, false);
  assert.equal(short.remainingMinor, 200, 'the UI shows what is left to allocate');

  const over = resolveSplit(1000, 'exact', [
    { memberId: 'a', value: 900 }, { memberId: 'b', value: 900 },
  ]);
  assert.equal(over.valid, false);
  assert.equal(over.remainingMinor, -800);
});

test('percent split must total 100% and still sums exactly', () => {
  const r = resolveSplit(1000, 'percent', [
    { memberId: 'a', value: 50 * PERCENT_SCALE },
    { memberId: 'b', value: 25 * PERCENT_SCALE },
    { memberId: 'c', value: 25 * PERCENT_SCALE },
  ]);
  assert.ok(r.valid);
  assert.deepEqual(r.owed, { a: 500, b: 250, c: 250 });

  const bad = resolveSplit(1000, 'percent', [
    { memberId: 'a', value: 50 * PERCENT_SCALE }, { memberId: 'b', value: 30 * PERCENT_SCALE },
  ]);
  assert.equal(bad.valid, false);
});

test('thirds as percentages still sum to the total', () => {
  // 33.33 + 33.33 + 33.34 = 100
  const r = resolveSplit(1000, 'percent', [
    { memberId: 'a', value: 3333 }, { memberId: 'b', value: 3333 }, { memberId: 'c', value: 3334 },
  ]);
  assert.ok(r.valid);
  assert.equal(totalOf(r.owed), 1000);
});

test('shares split weights by share count', () => {
  const r = resolveSplit(1200, 'shares', [
    { memberId: 'a', value: 2 }, { memberId: 'b', value: 1 }, { memberId: 'c', value: 1 },
  ]);
  assert.ok(r.valid);
  assert.deepEqual(r.owed, { a: 600, b: 300, c: 300 });
  assert.equal(totalOf(r.owed), 1200);
});

test('shares split rejects an all-zero allocation', () => {
  const r = resolveSplit(1200, 'shares', ids.map((memberId) => ({ memberId, value: 0 })));
  assert.equal(r.valid, false);
  assert.match(r.error, /at least one person/i);
});

test('adjustment split gives extras on top of an even base', () => {
  // 1200 total, a owes 300 extra -> base 900 split 3 ways = 300 each.
  const r = resolveSplit(1200, 'adjustment', [
    { memberId: 'a', value: 300 }, { memberId: 'b', value: 0 }, { memberId: 'c', value: 0 },
  ]);
  assert.ok(r.valid);
  assert.deepEqual(r.owed, { a: 600, b: 300, c: 300 });
  assert.equal(totalOf(r.owed), 1200);
});

test('adjustment split refuses adjustments larger than the total', () => {
  const r = resolveSplit(100, 'adjustment', [
    { memberId: 'a', value: 500 }, { memberId: 'b', value: 0 },
  ]);
  assert.equal(r.valid, false);
  assert.match(r.error, /more than the total/i);
});

test('every mode sums to the total across many totals (property check)', () => {
  const modes = ['equal', 'shares'];
  for (const mode of modes) {
    for (let total = 1; total < 500; total += 13) {
      for (let n = 1; n <= 6; n += 1) {
        const parts = Array.from({ length: n }, (_, i) => ({ memberId: `m${i}`, value: (i % 3) + 1 }));
        const r = resolveSplit(total, mode, parts);
        assert.ok(r.valid, `${mode} total=${total} n=${n}`);
        assert.equal(totalOf(r.owed), total, `${mode} total=${total} n=${n}`);
      }
    }
  }
});

test('an empty participant list is an error, not a crash', () => {
  const r = resolveSplit(1000, 'equal', []);
  assert.equal(r.valid, false);
  assert.match(r.error, /at least one person/i);
});

test('an unknown mode is reported rather than silently ignored', () => {
  const r = resolveSplit(1000, 'nonsense', [{ memberId: 'a', value: 0 }]);
  assert.equal(r.valid, false);
  assert.match(r.error, /unknown split mode/i);
});

test('seedParticipants starts each mode in a valid state', () => {
  const exact = seedParticipants(1000, 'exact', ids);
  assert.equal(resolveSplit(1000, 'exact', exact).valid, true);

  const pct = seedParticipants(1000, 'percent', ids);
  assert.equal(resolveSplit(1000, 'percent', pct).valid, true);

  const shares = seedParticipants(1000, 'shares', ids);
  assert.equal(resolveSplit(1000, 'shares', shares).valid, true);

  const adj = seedParticipants(1000, 'adjustment', ids);
  assert.equal(resolveSplit(1000, 'adjustment', adj).valid, true);
});

test('payers must cover the total', () => {
  assert.ok(resolvePayers(1000, [{ memberId: 'a', amountMinor: 1000 }]).valid);
  assert.ok(resolvePayers(1000, [
    { memberId: 'a', amountMinor: 600 }, { memberId: 'b', amountMinor: 400 },
  ]).valid);

  const short = resolvePayers(1000, [{ memberId: 'a', amountMinor: 700 }]);
  assert.equal(short.valid, false);
  assert.equal(short.remainingMinor, 300);
});
