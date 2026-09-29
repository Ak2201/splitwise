/**
 * CSV export, in the spirit of Splid's spreadsheet export.
 *
 * Two files are offered: the expense ledger (one row per expense, one column
 * per person showing their share) and the settlement summary.
 */
import { toDecimalString } from '../money.js';
import { netBalances, simplifiedDebts, groupTotals } from '../balance.js';

/**
 * RFC 4180 quoting. Also guards against CSV injection: a cell starting with
 * =, +, - or @ is treated as a formula by Excel and Sheets, so a group member
 * called "=cmd|..." could execute on someone else's machine when they open the
 * export. Prefixing with an apostrophe keeps it inert and still readable.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const RISKY_START = /^[=+@\t\r]|^-(?!\d)/;

export function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  // A negative amount is a number, not a formula. Guarding it would make
  // Excel treat the Net column as text and break every sum in the sheet.
  const guarded = !PLAIN_NUMBER.test(text) && RISKY_START.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(rows) {
  // CRLF and a UTF-8 BOM, because Excel otherwise mangles non-ASCII names.
  return '﻿' + rows.map((row) => row.map(escapeCell).join(',')).join('\r\n');
}

/** One row per expense; a column for each member's share. */
export function expensesCsv(group) {
  const { code } = group.currency;
  const members = group.members;

  const header = [
    'Date', 'Title', 'Category', 'Notes', 'Currency', 'Total',
    ...members.map((m) => `${m.name} paid`),
    ...members.map((m) => `${m.name} share`),
  ];

  const rows = [...group.expenses]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => {
      const paidBy = new Map(e.payers.map((p) => [p.memberId, p.amountMinor]));
      return [
        e.date,
        e.title,
        e.category,
        e.notes || '',
        code,
        toDecimalString(e.amountMinor, code),
        ...members.map((m) => (paidBy.has(m.id) ? toDecimalString(paidBy.get(m.id), code) : '')),
        ...members.map((m) => (e.owedMinor[m.id] !== undefined ? toDecimalString(e.owedMinor[m.id], code) : '')),
      ];
    });

  // Payments are part of the ledger too, marked so they can be filtered out.
  const payments = [...group.settlements]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => {
      const from = members.find((m) => m.id === s.fromMemberId);
      const to = members.find((m) => m.id === s.toMemberId);
      return [
        s.date,
        `Payment: ${from?.name || '?'} to ${to?.name || '?'}`,
        'settlement',
        s.notes || '',
        code,
        toDecimalString(s.amountMinor, code),
        ...members.map((m) => (m.id === s.fromMemberId ? toDecimalString(s.amountMinor, code) : '')),
        ...members.map((m) => (m.id === s.toMemberId ? toDecimalString(s.amountMinor, code) : '')),
      ];
    });

  const totals = groupTotals(group);
  const totalRow = [
    '', 'TOTAL', '', '', code, toDecimalString(totals.totalSpent, code),
    ...members.map((m) => toDecimalString(totals.perMember[m.id].paid, code)),
    ...members.map((m) => toDecimalString(totals.perMember[m.id].share, code)),
  ];

  return toCsv([header, ...rows, ...payments, [], totalRow]);
}

/** Balances and the suggested transfers to clear them. */
export function balancesCsv(group) {
  const { code } = group.currency;
  const net = netBalances(group);
  const totals = groupTotals(group);

  const rows = [
    ['Person', 'Paid', 'Share', 'Net', 'Status'],
    ...group.members.map((m) => {
      const value = net[m.id] || 0;
      return [
        m.name,
        toDecimalString(totals.perMember[m.id].paid, code),
        toDecimalString(totals.perMember[m.id].share, code),
        toDecimalString(value, code),
        value > 0 ? 'is owed' : value < 0 ? 'owes' : 'settled up',
      ];
    }),
    [],
    ['Suggested payments'],
    ['From', 'To', 'Amount'],
    ...simplifiedDebts(group).map((t) => [
      group.members.find((m) => m.id === t.fromMemberId)?.name || '?',
      group.members.find((m) => m.id === t.toMemberId)?.name || '?',
      toDecimalString(t.amountMinor, code),
    ]),
  ];

  return toCsv(rows);
}

/** A filesystem-safe filename stem from the group name. */
export function fileStem(group, suffix) {
  const slug = group.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'group';
  return `${slug}-${suffix}`;
}
