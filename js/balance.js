/**
 * Turns a group's expenses and settlements into balances.
 *
 * Two views, because they answer different questions:
 *  - pairwise:  who owes whom based on what actually happened (traceable)
 *  - simplify:  the fewest transfers that clear everything (convenient)
 */
import { allocate, sum } from './money.js';

/**
 * Net position per member: positive = they are owed money, negative = they owe.
 * The nets across a group always sum to zero; callers can rely on that.
 */
export function netBalances(group) {
  const net = {};
  for (const m of group.members) net[m.id] = 0;

  for (const e of group.expenses) {
    for (const p of e.payers) {
      if (net[p.memberId] === undefined) continue;
      net[p.memberId] += p.amountMinor;
    }
    for (const [memberId, owed] of Object.entries(e.owedMinor || {})) {
      if (net[memberId] === undefined) continue;
      net[memberId] -= owed;
    }
  }

  for (const s of group.settlements) {
    // Paying someone reduces what you owe them, and what they are owed.
    if (net[s.fromMemberId] !== undefined) net[s.fromMemberId] += s.amountMinor;
    if (net[s.toMemberId] !== undefined) net[s.toMemberId] -= s.amountMinor;
  }

  return net;
}

/**
 * Directed debt between each pair, derived from the real flow of each expense:
 * a participant owes their share to whoever paid, split across multiple payers
 * in proportion to what each of them put in.
 *
 * Reciprocal debts are netted, so a pair never appears owing each other both ways.
 */
export function pairwiseDebts(group) {
  const matrix = new Map(); // "debtor|creditor" -> minor units

  const add = (from, to, amount) => {
    if (from === to || amount <= 0) return;
    const key = `${from}|${to}`;
    matrix.set(key, (matrix.get(key) || 0) + amount);
  };

  for (const e of group.expenses) {
    const payers = e.payers.filter((p) => p.amountMinor > 0);
    if (payers.length === 0) continue;

    for (const [debtorId, owed] of Object.entries(e.owedMinor || {})) {
      if (owed <= 0) continue;

      if (payers.length === 1) {
        add(debtorId, payers[0].memberId, owed);
        continue;
      }
      // Spread this debtor's share across the payers, proportional to their outlay.
      const parts = allocate(owed, payers.map((p) => p.amountMinor));
      payers.forEach((p, i) => add(debtorId, p.memberId, parts[i]));
    }
  }

  for (const s of group.settlements) {
    // A payment cancels debt in the direction it was owed.
    add(s.toMemberId, s.fromMemberId, s.amountMinor);
  }

  // Net each pair against its reverse.
  const seen = new Set();
  const debts = [];
  for (const [key, amount] of matrix) {
    const [from, to] = key.split('|');
    const reverseKey = `${to}|${from}`;
    if (seen.has(key) || seen.has(reverseKey)) continue;
    seen.add(key);
    seen.add(reverseKey);

    const netAmount = amount - (matrix.get(reverseKey) || 0);
    if (netAmount > 0) debts.push({ fromMemberId: from, toMemberId: to, amountMinor: netAmount });
    else if (netAmount < 0) debts.push({ fromMemberId: to, toMemberId: from, amountMinor: -netAmount });
  }

  return debts.sort((a, b) => b.amountMinor - a.amountMinor);
}

/**
 * Fewest transfers that settle everyone, from the net balances.
 *
 * Greedy: repeatedly match the biggest debtor against the biggest creditor.
 * Each pass zeroes at least one person, so this yields at most n-1 transfers.
 * (Finding the true minimum is NP-hard; this is the standard practical answer
 * and is what Splitwise's "simplify debts" does in spirit.)
 */
export function simplifiedDebts(group) {
  const net = netBalances(group);

  const creditors = [];
  const debtors = [];
  for (const [memberId, amount] of Object.entries(net)) {
    if (amount > 0) creditors.push({ memberId, amount });
    else if (amount < 0) debtors.push({ memberId, amount: -amount });
  }

  creditors.sort((a, b) => b.amount - a.amount || a.memberId.localeCompare(b.memberId));
  debtors.sort((a, b) => b.amount - a.amount || a.memberId.localeCompare(b.memberId));

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0) {
      transfers.push({
        fromMemberId: debtors[i].memberId,
        toMemberId: creditors[j].memberId,
        amountMinor: amount,
      });
    }
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }

  return transfers;
}

/** Totals for the group header and the report. */
export function groupTotals(group) {
  const totalSpent = sum(group.expenses.map((e) => e.amountMinor));
  const perMember = {};
  for (const m of group.members) perMember[m.id] = { paid: 0, share: 0 };

  for (const e of group.expenses) {
    for (const p of e.payers) {
      if (perMember[p.memberId]) perMember[p.memberId].paid += p.amountMinor;
    }
    for (const [memberId, owed] of Object.entries(e.owedMinor || {})) {
      if (perMember[memberId]) perMember[memberId].share += owed;
    }
  }

  return { totalSpent, perMember, expenseCount: group.expenses.length };
}

/** Spend grouped by category, biggest first — drives the report's breakdown. */
export function categoryTotals(group) {
  const totals = new Map();
  for (const e of group.expenses) {
    const key = e.category || 'other';
    totals.set(key, (totals.get(key) || 0) + e.amountMinor);
  }
  return [...totals.entries()]
    .map(([category, amountMinor]) => ({ category, amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}
