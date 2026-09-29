import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeCell, toCsv, expensesCsv, balancesCsv, fileStem } from '../js/export/csv.js';
import { settlementText, fullText } from '../js/export/text.js';
import { buildBackup, buildGroupBackup, parseBackup, readBackup, BACKUP_KIND } from '../js/export/json.js';
import { normaliseGroup, normaliseState } from '../js/schema.js';

const group = normaliseGroup({
  id: 'g1',
  name: 'Goa trip',
  type: 'trip',
  currency: { code: 'INR', symbol: '₹' },
  members: [
    { id: 'aaa', name: 'Arun', color: '#2f9e7e' },
    { id: 'bbb', name: 'Priya', color: '#3b82c4' },
  ],
  expenses: [
    {
      id: 'e1', title: 'Dinner', category: 'food', notes: '', date: '2026-03-02',
      amountMinor: 3000,
      payers: [{ memberId: 'aaa', amountMinor: 3000 }],
      owedMinor: { aaa: 1500, bbb: 1500 },
      split: { mode: 'equal', participants: [] },
    },
    {
      id: 'e2', title: 'Taxi, airport', category: 'transport', notes: 'late night', date: '2026-03-01',
      amountMinor: 1000,
      payers: [{ memberId: 'bbb', amountMinor: 1000 }],
      owedMinor: { aaa: 500, bbb: 500 },
      split: { mode: 'equal', participants: [] },
    },
  ],
  settlements: [
    { id: 's1', fromMemberId: 'bbb', toMemberId: 'aaa', amountMinor: 500, date: '2026-03-05', notes: 'upi' },
  ],
  recurring: [],
});

test('escapeCell quotes only what needs quoting', () => {
  assert.equal(escapeCell('plain'), 'plain');
  assert.equal(escapeCell('has,comma'), '"has,comma"');
  assert.equal(escapeCell('has"quote'), '"has""quote"');
  assert.equal(escapeCell('line\nbreak'), '"line\nbreak"');
  assert.equal(escapeCell(''), '');
  assert.equal(escapeCell(null), '');
  assert.equal(escapeCell(undefined), '');
});

test('escapeCell neutralises spreadsheet formula injection', () => {
  // A member named "=1+1" must not evaluate when the CSV is opened in Excel.
  assert.equal(escapeCell('=1+1'), "'=1+1");
  assert.equal(escapeCell('+cmd'), "'+cmd");
  assert.equal(escapeCell('-cmd'), "'-cmd");
  // ...but a negative number is left alone, or Excel treats the column as text.
  assert.equal(escapeCell('-2'), '-2');
  assert.equal(escapeCell('-5.00'), '-5.00');
  assert.equal(escapeCell('5.00'), '5.00');
  assert.equal(escapeCell('@SUM(A1)'), "'@SUM(A1)");
  // And still quoted if it also contains a comma.
  assert.equal(escapeCell('=HYPERLINK("a","b")'), '"\'=HYPERLINK(""a"",""b"")"');
});

test('toCsv emits CRLF rows and a BOM for Excel', () => {
  const csv = toCsv([['a', 'b'], ['1', '2']]);
  assert.ok(csv.startsWith('﻿'), 'BOM present');
  assert.equal(csv.slice(1), 'a,b\r\n1,2');
});

test('expensesCsv has a column per member and sorts by date', () => {
  const csv = expensesCsv(group);
  const lines = csv.replace('﻿', '').split('\r\n');

  assert.equal(lines[0], 'Date,Title,Category,Notes,Currency,Total,Arun paid,Priya paid,Arun share,Priya share');
  assert.ok(lines[1].startsWith('2026-03-01,"Taxi, airport"'), 'earliest first, comma quoted');
  assert.ok(lines[2].startsWith('2026-03-02,Dinner'));

  // Dinner: Arun paid 30.00, both owe 15.00
  assert.equal(lines[2], '2026-03-02,Dinner,food,,INR,30.00,30.00,,15.00,15.00');
});

test('expensesCsv includes payments and a totals row', () => {
  const csv = expensesCsv(group).replace('﻿', '');
  assert.ok(csv.includes('Payment: Priya to Arun'), 'settlements appear');
  assert.ok(csv.includes('settlement'), 'and are labelled so they can be filtered out');

  const totalLine = csv.split('\r\n').find((l) => l.includes('TOTAL'));
  assert.equal(totalLine, ',TOTAL,,,INR,40.00,30.00,10.00,20.00,20.00');
});

test('balancesCsv reports net position and suggested payments', () => {
  const csv = balancesCsv(group).replace('﻿', '');
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Person,Paid,Share,Net,Status');
  // Arun paid 30, share 20, received a 5.00 payment -> net +5.00
  assert.equal(lines[1], 'Arun,30.00,20.00,5.00,is owed');
  assert.equal(lines[2], 'Priya,10.00,20.00,-5.00,owes');
  assert.ok(csv.includes('Suggested payments'));
  assert.ok(csv.includes('Priya,Arun,5.00'));
});

test('fileStem produces a safe filename', () => {
  assert.equal(fileStem(group, 'expenses'), 'goa-trip-expenses');
  assert.equal(fileStem({ name: '  Weird  //  Name!! ' }, 'x'), 'weird-name-x');
  assert.equal(fileStem({ name: 'गोवा' }, 'x'), 'group-x', 'falls back when nothing survives');
});

test('settlementText reads as a chat message', () => {
  const text = settlementText(group);
  assert.ok(text.startsWith('Goa trip\n'));
  assert.ok(text.includes('Total spent: ₹40.00 across 2 expenses'));
  assert.ok(text.includes('- Arun: paid ₹30.00, share ₹20.00'));
  assert.ok(text.includes('Priya pays Arun ₹5.00'));
  assert.ok(!text.includes('|'), 'no table pipes - they render badly in chat apps');
});

test('settlementText says so when everyone is square', () => {
  const settled = normaliseGroup({
    ...group,
    settlements: [
      ...group.settlements,
      { id: 's2', fromMemberId: 'bbb', toMemberId: 'aaa', amountMinor: 500, date: '2026-03-06' },
    ],
  });
  assert.ok(settlementText(settled).includes('Everyone is settled up.'));
});

test('fullText lists every expense and payment', () => {
  const text = fullText(group);
  assert.ok(text.includes('Dinner'));
  assert.ok(text.includes('Taxi, airport'));
  assert.ok(text.includes('paid by Arun'));
  assert.ok(text.includes('Payments'));
  assert.ok(text.includes('Priya paid Arun'));
});

test('a backup round-trips through parseBackup', () => {
  const state = normaliseState({ groups: { g1: group }, activeGroupId: 'g1' });
  const backup = buildBackup(state);
  assert.equal(backup.kind, BACKUP_KIND);

  const restored = parseBackup(JSON.stringify(backup));
  assert.equal(Object.keys(restored.groups).length, 1);
  assert.equal(restored.groups.g1.name, 'Goa trip');
  assert.equal(restored.groups.g1.expenses.length, 2);
});

test('parseBackup accepts a bare state and rejects junk', () => {
  assert.ok(parseBackup(JSON.stringify({ groups: { g1: group } })).groups);
  assert.throws(() => parseBackup('not json'), /not valid JSON/i);
  assert.throws(() => parseBackup('null'), /empty/i);
  assert.throws(() => parseBackup('{"unrelated":true}'), /does not look like a backup/i);
});


test('a whole-library backup and a single-group export are distinguishable', () => {
  const state = normaliseState({ groups: { g1: group }, activeGroupId: 'g1' });

  const all = readBackup(JSON.stringify(buildBackup(state)));
  assert.equal(all.scope, 'all');
  assert.equal(all.groups.length, 1);

  const one = readBackup(JSON.stringify(buildGroupBackup(group)));
  assert.equal(one.scope, 'group', 'restoring this must add, not replace everything');
  assert.equal(one.groups.length, 1);
  assert.equal(one.groups[0].name, 'Goa trip');
});

test('a multi-group library file is treated as a full backup', () => {
  const second = normaliseGroup({ ...group, id: 'g2', name: 'Second' });
  const state = normaliseState({ groups: { g1: group, g2: second } });
  assert.equal(readBackup(JSON.stringify(buildBackup(state))).scope, 'all');
});

test('an unmarked file falls back to the safe reading', () => {
  // Written before `scope` existed: one group means "add", several mean "replace".
  const oneGroup = { kind: BACKUP_KIND, version: 1, state: { groups: { g1: group } } };
  assert.equal(readBackup(JSON.stringify(oneGroup)).scope, 'group');

  const second = normaliseGroup({ ...group, id: 'g2', name: 'Second' });
  const twoGroups = { kind: BACKUP_KIND, version: 1, state: { groups: { g1: group, g2: second } } };
  assert.equal(readBackup(JSON.stringify(twoGroups)).scope, 'all');

  // A bare group object, no envelope at all.
  assert.equal(readBackup(JSON.stringify(group)).scope, 'group');
});

test('readBackup rejects the same junk parseBackup does', () => {
  assert.throws(() => readBackup('not json'), /not valid JSON/i);
  assert.throws(() => readBackup('null'), /empty/i);
  assert.throws(() => readBackup('{"unrelated":true}'), /does not look like a backup/i);
  // parseBackup still returns just the state, for callers that only replace.
  assert.ok(parseBackup(JSON.stringify(buildBackup(normaliseState({ groups: { g1: group } })))).groups);
});
