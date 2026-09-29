/**
 * Plain-text summary, shaped for pasting into a group chat.
 *
 * No markdown tables or box drawing: WhatsApp, Signal and iMessage all render
 * those badly on a phone. Just short lines and a blank line between sections.
 */
import { formatMoney } from '../money.js';
import { netBalances, simplifiedDebts, pairwiseDebts, groupTotals } from '../balance.js';
import { formatDate } from '../util/date.js';

export function settlementText(group, { simplify = true } = {}) {
  const { currency } = group;
  const money = (v) => formatMoney(v, currency);
  const nameOf = (id) => group.members.find((m) => m.id === id)?.name || 'Someone';

  const totals = groupTotals(group);
  const net = netBalances(group);
  const transfers = simplify ? simplifiedDebts(group) : pairwiseDebts(group);

  const lines = [];
  lines.push(group.name);
  lines.push(`Total spent: ${money(totals.totalSpent)} across ${totals.expenseCount} ${totals.expenseCount === 1 ? 'expense' : 'expenses'}`);
  lines.push('');

  lines.push('Who paid what');
  for (const m of group.members) {
    const { paid, share } = totals.perMember[m.id];
    lines.push(`- ${m.name}: paid ${money(paid)}, share ${money(share)}`);
  }
  lines.push('');

  if (transfers.length === 0) {
    lines.push('Everyone is settled up.');
  } else {
    lines.push(simplify ? 'Settle up (simplified)' : 'Settle up');
    for (const t of transfers) {
      lines.push(`- ${nameOf(t.fromMemberId)} pays ${nameOf(t.toMemberId)} ${money(t.amountMinor)}`);
    }
  }

  const settledMembers = group.members.filter((m) => (net[m.id] || 0) === 0);
  if (settledMembers.length > 0 && transfers.length > 0) {
    lines.push('');
    lines.push(`Settled up: ${settledMembers.map((m) => m.name).join(', ')}`);
  }

  return lines.join('\n');
}

/** A longer version that lists every expense - useful for a trip wrap-up. */
export function fullText(group) {
  const money = (v) => formatMoney(v, group.currency);
  const nameOf = (id) => group.members.find((m) => m.id === id)?.name || 'Someone';

  const lines = [settlementText(group), '', 'Expenses'];

  const sorted = [...group.expenses].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sorted) {
    const payers = e.payers.map((p) => nameOf(p.memberId)).join(' & ') || 'someone';
    lines.push(`- ${formatDate(e.date)}  ${e.title}  ${money(e.amountMinor)}  (paid by ${payers})`);
  }

  if (group.settlements.length > 0) {
    lines.push('');
    lines.push('Payments');
    for (const s of [...group.settlements].sort((a, b) => a.date.localeCompare(b.date))) {
      lines.push(`- ${formatDate(s.date)}  ${nameOf(s.fromMemberId)} paid ${nameOf(s.toMemberId)} ${money(s.amountMinor)}`);
    }
  }

  return lines.join('\n');
}
