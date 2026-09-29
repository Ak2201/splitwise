import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, addYears, addDays, parseISO, isValidISO, daysInMonth,
  isLeapYear, compareISO, daysBetween, formatDate, relativeDay,
} from '../js/util/date.js';

test('addMonths clamps to the end of a short month (Temporal "constrain")', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29', 'leap year');
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30');
  assert.equal(addMonths('2026-05-31', 1), '2026-06-30');
});

test('addMonths does not drift once it has been clamped', () => {
  // Each step recomputes from the clamped date, matching Temporal.
  assert.equal(addMonths('2024-02-29', 1), '2024-03-29');
  assert.equal(addMonths('2026-02-28', 1), '2026-03-28');
});

test('addMonths crosses year boundaries in both directions', () => {
  assert.equal(addMonths('2025-12-15', 1), '2026-01-15');
  assert.equal(addMonths('2025-12-15', 2), '2026-02-15');
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
  assert.equal(addMonths('2026-01-15', -13), '2024-12-15');
  assert.equal(addMonths('2026-06-15', 12), '2027-06-15');
});

test('addYears clamps 29 Feb onto a non-leap year', () => {
  assert.equal(addYears('2024-02-29', 1), '2025-02-28');
  assert.equal(addYears('2024-02-29', 4), '2028-02-29');
});

test('addDays crosses months, years and leap days', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-01-01', 7), '2026-01-08');
});

test('parseISO rejects impossible dates', () => {
  assert.deepEqual(parseISO('2026-03-12'), { y: 2026, m: 3, d: 12 });
  assert.equal(parseISO('2026-02-30'), null);
  assert.equal(parseISO('2026-13-01'), null);
  assert.equal(parseISO('2026-00-10'), null);
  assert.equal(parseISO('2026-01-00'), null);
  assert.equal(parseISO('not-a-date'), null);
  assert.equal(parseISO(''), null);
  assert.equal(parseISO(null), null);
  assert.equal(isValidISO('2024-02-29'), true);
  assert.equal(isValidISO('2025-02-29'), false);
});

test('leap year rules include the century cases', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2025), false);
  assert.equal(isLeapYear(1900), false, 'divisible by 100 but not 400');
  assert.equal(isLeapYear(2000), true, 'divisible by 400');
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2025, 2), 28);
  assert.equal(daysInMonth(2026, 4), 30);
});

test('comparison and day counting', () => {
  assert.equal(compareISO('2026-01-01', '2026-01-02'), -1);
  assert.equal(compareISO('2026-01-02', '2026-01-01'), 1);
  assert.equal(compareISO('2026-01-01', '2026-01-01'), 0);
  assert.equal(daysBetween('2026-01-01', '2026-01-08'), 7);
  assert.equal(daysBetween('2026-01-08', '2026-01-01'), -7);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2, 'counts the leap day');
});

test('display helpers do not shift the day across timezones', () => {
  // A naive `new Date('2026-01-01')` renders as 31 Dec west of Greenwich.
  assert.match(formatDate('2026-01-01'), /^1 Jan/);
  assert.match(formatDate('2020-06-15'), /^15 Jun 2020$/);
  assert.equal(formatDate('bad'), '');
  assert.equal(relativeDay('2026-01-01', '2026-01-01'), 'Today');
  assert.equal(relativeDay('2026-01-02', '2026-01-01'), 'Tomorrow');
  assert.equal(relativeDay('2025-12-31', '2026-01-01'), 'Yesterday');
  assert.equal(relativeDay('2026-01-04', '2026-01-01'), 'in 3 days');
  assert.equal(relativeDay('2025-12-27', '2026-01-01'), '5 days ago');
});
