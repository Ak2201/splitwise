import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGroup, decodeGroup, buildShareUrl, readShareCodeFromHash, toSharePayload } from '../js/share.js';
import { normaliseGroup } from '../js/schema.js';

function sampleGroup(expenseCount = 3) {
  const members = [
    { id: 'aaa', name: 'Arun', color: '#2f9e7e' },
    { id: 'bbb', name: 'Priya', color: '#3b82c4' },
    { id: 'ccc', name: 'Sam', color: '#b4533f' },
  ];
  const expenses = Array.from({ length: expenseCount }, (_, i) => ({
    id: `e${i}`,
    title: `Dinner ${i}`,
    category: 'food',
    notes: 'split at the table',
    date: '2026-03-01',
    amountMinor: 3000,
    payers: [{ memberId: 'aaa', amountMinor: 3000 }],
    owedMinor: { aaa: 1000, bbb: 1000, ccc: 1000 },
    split: { mode: 'equal', participants: [] },
  }));
  return normaliseGroup({
    id: 'grp1',
    name: 'Goa trip',
    type: 'trip',
    currency: { code: 'INR', symbol: '₹' },
    members,
    expenses,
    settlements: [
      { id: 's1', fromMemberId: 'bbb', toMemberId: 'aaa', amountMinor: 500, date: '2026-03-02', notes: 'upi' },
    ],
    recurring: [],
  });
}

test('a group survives the round trip intact', async () => {
  const group = sampleGroup();
  const decoded = await decodeGroup(await encodeGroup(group));

  assert.equal(decoded.name, 'Goa trip');
  assert.equal(decoded.type, 'trip');
  assert.equal(decoded.currency.code, 'INR');
  assert.equal(decoded.currency.symbol, '₹');
  assert.equal(decoded.members.length, 3);
  assert.deepEqual(decoded.members.map((m) => m.name), ['Arun', 'Priya', 'Sam']);
  assert.equal(decoded.expenses.length, 3);
  assert.equal(decoded.settlements.length, 1);
});

test('amounts and shares come back to the exact minor unit', async () => {
  const group = sampleGroup(1);
  const decoded = await decodeGroup(await encodeGroup(group));

  const before = group.expenses[0];
  const after = decoded.expenses[0];
  assert.equal(after.amountMinor, before.amountMinor);
  assert.deepEqual(after.owedMinor, before.owedMinor);
  assert.deepEqual(after.payers, before.payers);
  assert.equal(after.title, before.title);
  assert.equal(after.notes, before.notes);
  assert.equal(after.date, before.date);
  assert.equal(after.category, before.category);
});

test('unicode names and symbols survive encoding', async () => {
  const group = normaliseGroup({
    ...sampleGroup(1),
    name: 'गोवा \u{1F3D6}️',
    members: [
      { id: 'aaa', name: 'अरुण', color: '#2f9e7e' },
      { id: 'bbb', name: 'José', color: '#3b82c4' },
    ],
    expenses: [],
    settlements: [],
  });
  const decoded = await decodeGroup(await encodeGroup(group));
  assert.equal(decoded.name, 'गोवा \u{1F3D6}️');
  assert.deepEqual(decoded.members.map((m) => m.name), ['अरुण', 'José']);
});

test('compression actually shrinks a realistic group', async () => {
  const group = sampleGroup(40);
  const code = await encodeGroup(group);
  const rawSize = JSON.stringify(toSharePayload(group)).length;
  assert.equal(code[0], 'z', 'deflate branch was used');
  assert.ok(code.length < rawSize, `compressed ${code.length} < raw ${rawSize}`);
});

test('share codes round-trip through a URL', async () => {
  const code = await encodeGroup(sampleGroup(1));
  const url = buildShareUrl(code, 'https://example.com/app/');
  assert.ok(url.includes('#/import/'));
  assert.equal(readShareCodeFromHash(new URL(url).hash), code);
  assert.equal(await decodeGroup(readShareCodeFromHash(new URL(url).hash)).then((g) => g.name), 'Goa trip');
});

test('readShareCodeFromHash ignores unrelated fragments', () => {
  assert.equal(readShareCodeFromHash('#/groups'), null);
  assert.equal(readShareCodeFromHash(''), null);
  assert.equal(readShareCodeFromHash('#'), null);
});

test('damaged and hostile codes are rejected with a readable message', async () => {
  await assert.rejects(() => decodeGroup(''), /empty/i);
  await assert.rejects(() => decodeGroup('hello'), /does not look like/i);
  await assert.rejects(() => decodeGroup('z!!!!not-base64!!!'), /damaged|incomplete/i);

  // Valid base64 and valid JSON, but not a share payload.
  const notPayload = 'u' + Buffer.from('{"hello":"world"}').toString('base64url');
  await assert.rejects(() => decodeGroup(notPayload), /different version/i);

  // Right envelope, but the group inside is unusable.
  const noMembers = 'u' + Buffer.from(JSON.stringify({ v: 1, n: 'x', m: [], e: [] })).toString('base64url');
  await assert.rejects(() => decodeGroup(noMembers), /no members/i);
});

test('an imported payload cannot smuggle in extra fields', async () => {
  const hostile = {
    v: 1,
    n: 'Evil',
    c: ['INR', '₹'],
    m: [['aaa', '<script>alert(1)</script>', '#2f9e7e']],
    e: [],
    s: [],
    __proto__: { polluted: true },
    extraneous: 'ignored',
  };
  const code = 'u' + Buffer.from(JSON.stringify(hostile)).toString('base64url');
  const group = await decodeGroup(code);

  assert.equal(group.extraneous, undefined, 'unknown fields are dropped');
  assert.equal({}.polluted, undefined, 'no prototype pollution');
  // The name is preserved as literal text; it is only ever written via textContent.
  assert.equal(group.members[0].name, '<script>alert(1)</script>');
});

test('incoherent expenses in a share code are dropped, not imported', async () => {
  const payload = {
    v: 1, n: 'Broken', c: ['INR', '₹'],
    m: [['aaa', 'A', '#2f9e7e'], ['bbb', 'B', '#3b82c4']],
    // Total 3000 but the shares only add to 1000.
    e: [['e1', 'Bad', 'food', '2026-01-01', 3000, [['aaa', 3000]], [['aaa', 1000]], 'equal', '']],
    s: [],
  };
  const code = 'u' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  const group = await decodeGroup(code);
  assert.equal(group.expenses.length, 0, 'the unbalanced expense is discarded');
});
