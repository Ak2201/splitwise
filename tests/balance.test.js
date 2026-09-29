import test from 'node:test';
import assert from 'node:assert/strict';
import { netBalances, pairwiseDebts, simplifiedDebts, groupTotals, categoryTotals } from '../js/balance.js';
import { resolveSplit } from '../js/split.js';

function makeGroup(memberIds, expenses = [], settlements = []) {
  return {
    members: memberIds.map((id) => ({ id, name: id.toUpperCase() })),
    expenses,
    settlements,
  };
}

/** Build an expense the way the app does: resolve the split, then store it. */
function expense({ amount, payers, participants, mode = 'equal', category = 'other', date = '2026-01-01' }) {
  const { owed } = resolveSplit(amount, mode, participants);
  return { id: `e${Math.random()}`, title: 't', category, date, amountMinor: amount, payers, owedMinor: owed };
}

test('one payer, even split', () => {
  const g = makeGroup(['a', 'b', 'c'], [
    expense({
      amount: 3000,
      payers: [{ memberId: 'a', amountMinor: 3000 }],
      participants: ['a', 'b', 'c'].map((memberId) => ({ memberId, value: 0 })),
    }),
  ]);
  assert.deepEqual(netBalances(g), { a: 2000, b: -1000, c: -1000 });
});

test('net balances always sum to zero', () => {
  const g = makeGroup(['a', 'b', 'c', 'd'], [
    expense({ amount: 1000, payers: [{ memberId: 'a', amountMinor: 1000 }], participants: ['a','b','c'].map((m)=>({memberId:m,value:0})) }),
    expense({ amount: 777,  payers: [{ memberId: 'b', amountMinor: 777 }],  participants: ['a','b','c','d'].map((m)=>({memberId:m,value:0})) }),
    expense({ amount: 55,   payers: [{ memberId: 'd', amountMinor: 55 }],   participants: ['c','d'].map((m)=>({memberId:m,value:0})) }),
  ], [
    { id: 's1', fromMemberId: 'c', toMemberId: 'a', amountMinor: 300, date: '2026-01-05' },
  ]);
  const net = netBalances(g);
  assert.equal(Object.values(net).reduce((x, y) => x + y, 0), 0);
});

test('a settlement moves the balance and can clear it entirely', () => {
  const g = makeGroup(['a', 'b'], [
    expense({ amount: 1000, payers: [{ memberId: 'a', amountMinor: 1000 }], participants: ['a','b'].map((m)=>({memberId:m,value:0})) }),
  ]);
  assert.deepEqual(netBalances(g), { a: 500, b: -500 });

  g.settlements.push({ id: 's', fromMemberId: 'b', toMemberId: 'a', amountMinor: 500, date: '2026-01-02' });
  assert.deepEqual(netBalances(g), { a: 0, b: 0 });
  assert.deepEqual(pairwiseDebts(g), [], 'nothing left owing');
});

test('multiple payers are credited in proportion', () => {
  // a paid 800, b paid 200, split evenly 3 ways (a, b, c each owe ~333).
  const g = makeGroup(['a', 'b', 'c'], [
    expense({
      amount: 1000,
      payers: [{ memberId: 'a', amountMinor: 800 }, { memberId: 'b', amountMinor: 200 }],
      participants: ['a','b','c'].map((m)=>({memberId:m,value:0})),
    }),
  ]);
  const net = netBalances(g);
  assert.equal(net.a + net.b + net.c, 0);
  assert.equal(net.a, 800 - 334);
  assert.equal(net.b, 200 - 333);
  assert.equal(net.c, -333);

  // c's 333 share is owed to both payers, 80/20.
  const debts = pairwiseDebts(g);
  const cDebts = debts.filter((d) => d.fromMemberId === 'c');
  assert.equal(cDebts.reduce((x, d) => x + d.amountMinor, 0), 333);
});

test('pairwise nets reciprocal debts into one direction', () => {
  const g = makeGroup(['a', 'b'], [
    expense({ amount: 1000, payers: [{ memberId: 'a', amountMinor: 1000 }], participants: ['a','b'].map((m)=>({memberId:m,value:0})) }),
    expense({ amount: 400,  payers: [{ memberId: 'b', amountMinor: 400 }],  participants: ['a','b'].map((m)=>({memberId:m,value:0})) }),
  ]);
  const debts = pairwiseDebts(g);
  assert.equal(debts.length, 1, 'one row, not two opposing ones');
  assert.deepEqual(debts[0], { fromMemberId: 'b', toMemberId: 'a', amountMinor: 300 });
});

test('simplify clears every balance and uses at most n-1 transfers', () => {
  const g = makeGroup(['a', 'b', 'c', 'd'], [
    expense({ amount: 6000, payers: [{ memberId: 'a', amountMinor: 6000 }], participants: ['a','b','c','d'].map((m)=>({memberId:m,value:0})) }),
    expense({ amount: 2000, payers: [{ memberId: 'b', amountMinor: 2000 }], participants: ['c','d'].map((m)=>({memberId:m,value:0})) }),
    expense({ amount: 900,  payers: [{ memberId: 'c', amountMinor: 900 }],  participants: ['a','b','c'].map((m)=>({memberId:m,value:0})) }),
  ]);

  const before = netBalances(g);
  const transfers = simplifiedDebts(g);
  assert.ok(transfers.length <= g.members.length - 1, `${transfers.length} transfers for 4 members`);

  // Applying the transfers must zero every balance.
  const after = { ...before };
  for (const t of transfers) {
    after[t.fromMemberId] += t.amountMinor;
    after[t.toMemberId] -= t.amountMinor;
  }
  for (const [id, amount] of Object.entries(after)) {
    assert.equal(amount, 0, `${id} not settled`);
  }
});

test('simplify settles randomised groups (property check)', () => {
  let seed = 42;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };

  for (let round = 0; round < 60; round += 1) {
    const n = 2 + rand(5);
    const ids = Array.from({ length: n }, (_, i) => `m${i}`);
    const expenses = [];
    for (let e = 0; e < 1 + rand(6); e += 1) {
      const amount = 1 + rand(9999);
      const payer = ids[rand(n)];
      const parts = ids.filter(() => rand(2) === 0);
      if (parts.length === 0) parts.push(ids[rand(n)]);
      expenses.push(expense({
        amount,
        payers: [{ memberId: payer, amountMinor: amount }],
        participants: parts.map((memberId) => ({ memberId, value: 0 })),
      }));
    }
    const g = makeGroup(ids, expenses);
    const net = netBalances(g);
    assert.equal(Object.values(net).reduce((x, y) => x + y, 0), 0, `round ${round}: nets must sum to zero`);

    const after = { ...net };
    for (const t of simplifiedDebts(g)) {
      after[t.fromMemberId] += t.amountMinor;
      after[t.toMemberId] -= t.amountMinor;
    }
    assert.ok(Object.values(after).every((v) => v === 0), `round ${round}: simplify must settle everyone`);
  }
});

test('a group with no expenses is all zeroes, not an error', () => {
  const g = makeGroup(['a', 'b']);
  assert.deepEqual(netBalances(g), { a: 0, b: 0 });
  assert.deepEqual(pairwiseDebts(g), []);
  assert.deepEqual(simplifiedDebts(g), []);
  assert.equal(groupTotals(g).totalSpent, 0);
});

test('an expense referencing a removed member does not corrupt the rest', () => {
  const g = makeGroup(['a', 'b'], [
    expense({ amount: 900, payers: [{ memberId: 'a', amountMinor: 900 }], participants: ['a','b','ghost'].map((m)=>({memberId:m,value:0})) }),
  ]);
  const net = netBalances(g);
  assert.equal(Object.keys(net).length, 2, 'only current members appear');
  assert.equal(net.a, 900 - 300);
  assert.equal(net.b, -300);
});

test('totals and category breakdown', () => {
  const g = makeGroup(['a', 'b'], [
    expense({ amount: 1000, category: 'food',  payers: [{ memberId: 'a', amountMinor: 1000 }], participants: ['a','b'].map((m)=>({memberId:m,value:0})) }),
    expense({ amount: 500,  category: 'food',  payers: [{ memberId: 'b', amountMinor: 500 }],  participants: ['a','b'].map((m)=>({memberId:m,value:0})) }),
    expense({ amount: 2000, category: 'stay',  payers: [{ memberId: 'a', amountMinor: 2000 }], participants: ['a','b'].map((m)=>({memberId:m,value:0})) }),
  ]);
  const t = groupTotals(g);
  assert.equal(t.totalSpent, 3500);
  assert.equal(t.expenseCount, 3);
  assert.equal(t.perMember.a.paid, 3000);
  assert.equal(t.perMember.b.paid, 500);
  assert.equal(t.perMember.a.share + t.perMember.b.share, 3500);

  assert.deepEqual(categoryTotals(g), [
    { category: 'stay', amountMinor: 2000 },
    { category: 'food', amountMinor: 1500 },
  ]);
});
