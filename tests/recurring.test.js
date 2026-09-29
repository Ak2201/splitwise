import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, dueDates, nextOccurrence, generateDue, upcoming, describeFrequency, MAX_CATCHUP } from '../js/recurring.js';

const template = (over = {}) => ({
  id: 't1',
  active: true,
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-01-01',
  nextDueDate: '2026-01-01',
  endDate: null,
  expense: {
    title: 'Rent', category: 'home', amountMinor: 200000,
    payers: [{ memberId: 'a', amountMinor: 200000 }],
    owedMinor: { a: 100000, b: 100000 },
    split: { mode: 'equal', participants: [] },
  },
  ...over,
});

test('advance steps by each frequency', () => {
  assert.equal(advance('2026-01-01', 'daily'), '2026-01-02');
  assert.equal(advance('2026-01-01', 'weekly'), '2026-01-08');
  assert.equal(advance('2026-01-01', 'monthly'), '2026-02-01');
  assert.equal(advance('2026-01-01', 'yearly'), '2027-01-01');
  assert.equal(advance('2026-01-01', 'weekly', 2), '2026-01-15');
  assert.equal(advance('2026-01-31', 'monthly'), '2026-02-28', 'clamps like Temporal');
});

test('nothing is due before the start date', () => {
  assert.deepEqual(dueDates(template(), '2025-12-31'), []);
});

test('catches up every missed occurrence', () => {
  // Opened the app on 15 Apr after a Jan 1 monthly start: Jan, Feb, Mar, Apr.
  assert.deepEqual(dueDates(template(), '2026-04-15'),
    ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
});

test('an inactive template generates nothing', () => {
  assert.deepEqual(dueDates(template({ active: false }), '2026-06-01'), []);
});

test('generation stops at the end date', () => {
  const dates = dueDates(template({ endDate: '2026-03-15' }), '2026-12-01');
  assert.deepEqual(dates, ['2026-01-01', '2026-02-01', '2026-03-01']);
});

test('catch-up is capped so a stale template cannot flood the group', () => {
  const dates = dueDates(template({ frequency: 'daily' }), '2030-01-01');
  assert.equal(dates.length, MAX_CATCHUP);
});

test('generateDue produces expenses and moves the template forward', () => {
  const group = { recurring: [template()] };
  const { created, templates } = generateDue(group, '2026-03-10');

  assert.equal(created.length, 3, 'Jan, Feb and Mar');
  assert.deepEqual(created.map((e) => e.date), ['2026-01-01', '2026-02-01', '2026-03-01']);
  assert.equal(created[0].title, 'Rent');
  assert.equal(created[0].amountMinor, 200000);
  assert.equal(created[0].recurringId, 't1');
  assert.equal(new Set(created.map((e) => e.id)).size, 3, 'each occurrence gets its own id');

  assert.equal(templates[0].nextDueDate, '2026-04-01');
  assert.equal(templates[0].lastGeneratedDate, '2026-03-01');
});

test('generated expenses do not share mutable state with the template', () => {
  const group = { recurring: [template()] };
  const { created } = generateDue(group, '2026-01-10');
  created[0].payers[0].amountMinor = 1;
  assert.equal(group.recurring[0].expense.payers[0].amountMinor, 200000, 'template untouched');
});

test('running generation twice does not duplicate expenses', () => {
  const group = { recurring: [template()] };
  const first = generateDue(group, '2026-03-10');
  assert.equal(first.created.length, 3);

  const second = generateDue({ recurring: first.templates }, '2026-03-10');
  assert.equal(second.created.length, 0, 'already caught up');
});

test('a template whose end date has passed deactivates itself', () => {
  const group = { recurring: [template({ endDate: '2026-02-15' })] };
  const { templates } = generateDue(group, '2026-06-01');
  assert.equal(templates[0].active, false);
});

test('nextOccurrence looks past everything already due', () => {
  assert.equal(nextOccurrence(template(), '2026-03-10'), '2026-04-01');
  assert.equal(nextOccurrence(template(), '2025-12-01'), '2026-01-01');
  assert.equal(nextOccurrence(template({ endDate: '2026-02-01' }), '2026-03-01'), null);
});

test('upcoming lists only what falls inside the horizon', () => {
  const group = {
    recurring: [
      template({ id: 'soon', nextDueDate: '2026-03-12' }),
      template({ id: 'later', nextDueDate: '2026-09-01' }),
      template({ id: 'off', nextDueDate: '2026-03-11', active: false }),
    ],
  };
  const list = upcoming(group, 7, '2026-03-10');
  assert.deepEqual(list.map((x) => x.template.id), ['soon']);
});

test('frequency descriptions read naturally', () => {
  assert.equal(describeFrequency('monthly', 1), 'Monthly');
  assert.equal(describeFrequency('weekly', 2), 'Every 2 weeks');
  assert.equal(describeFrequency('daily', 3), 'Every 3 days');
});
