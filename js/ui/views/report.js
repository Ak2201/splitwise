/**
 * Export, share and print.
 *
 * Two things live on this screen. On top, the export actions. Underneath, the
 * full report markup, which `styles/print.css` hides on screen and reveals on
 * paper — that is also the PDF path, since "Save as PDF" in the browser's own
 * print dialog produces the file and saves the project a PDF library.
 */
import { h, append, clear, icon, ICONS } from '../../util/dom.js';
import { openSheet, emptyState } from '../components.js';
import { formatMoney } from '../../money.js';
import { groupTotals, netBalances, simplifiedDebts } from '../../balance.js';
import { CATEGORIES } from '../../schema.js';
import { formatDate, todayISO, compareISO } from '../../util/date.js';
import { expensesCsv, balancesCsv, fileStem } from '../../export/csv.js';
import { settlementText, fullText } from '../../export/text.js';
import { buildGroupBackup } from '../../export/json.js';
import { downloadCsv, downloadJson, copyText, shareText } from '../../export/download.js';
import { encodeGroupLink } from '../../share.js';

/**
 * formatDate() drops the year inside the current year, which reads well in the
 * app but badly on a printout that may be read a year later.
 */
function dateWithYear(iso) {
  const year = String(iso).slice(0, 4);
  const base = formatDate(iso);
  return base.endsWith(year) ? base : `${base} ${year}`;
}

function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label || 'Other';
}

function card(title, description, controls) {
  return h('div.card', null, [
    h('div.stack.stack--tight', null, [
      h('h3', { text: title }),
      description ? h('p.small.muted', { text: description }) : null,
      h('div.row.row--wrap', null, controls),
    ]),
  ]);
}

function button(label, iconPath, onclick, { primary = false } = {}) {
  return h(`button.btn.btn--sm${primary ? '.btn--primary' : ''}`, { type: 'button', onclick },
    [iconPath ? icon(iconPath, { size: 16 }) : null, h('span', { text: label })]);
}

// --- the printable report ---------------------------------------------------

function buildReport(group) {
  const money = (value) => formatMoney(value, group.currency);
  const totals = groupTotals(group);
  const net = netBalances(group);
  const transfers = simplifiedDebts(group);
  const nameOf = (id) => group.members.find((m) => m.id === id)?.name || 'Someone';

  const expenses = [...group.expenses].sort(
    (a, b) => compareISO(a.date, b.date) || String(a.createdAt).localeCompare(String(b.createdAt)),
  );

  let range = 'No expenses yet';
  if (expenses.length > 0) {
    const first = dateWithYear(expenses[0].date);
    const last = dateWithYear(expenses[expenses.length - 1].date);
    range = first === last ? first : `${first} – ${last}`;
  }

  const section = (heading, body) => h('section.report__section', null, [h('h2', { text: heading }), body]);

  const summaryRow = (label, value) => h('tr', null, [
    h('th', { scope: 'row', text: label }),
    h('td.num', { text: value }),
  ]);

  const summary = section('Summary', h('table', null, h('tbody', null, [
    summaryRow('Total spent', money(totals.totalSpent)),
    summaryRow('Expenses', String(totals.expenseCount)),
    summaryRow('People', String(group.members.length)),
    summaryRow('Dates', range),
  ])));

  const perMember = section('Per person', h('table', null, [
    h('thead', null, h('tr', null, [
      h('th', { scope: 'col', text: 'Person' }),
      h('th.num', { scope: 'col', text: 'Paid' }),
      h('th.num', { scope: 'col', text: 'Share' }),
      h('th.num', { scope: 'col', text: 'Net' }),
    ])),
    h('tbody', null, group.members.map((m) => {
      const value = net[m.id] || 0;
      return h('tr', null, [
        h('td', { text: m.name }),
        h('td.num', { text: money(totals.perMember[m.id].paid) }),
        h('td.num', { text: money(totals.perMember[m.id].share) }),
        // Signed, so a printed row says which way the money goes without a key.
        h('td.num', { text: formatMoney(value, group.currency, { signed: true }) }),
      ]);
    })),
  ]));

  const settle = section('Settle up', transfers.length === 0
    ? h('p', { text: 'Everyone is settled up.' })
    : h('ul.report__settle', null, transfers.map((t) => h('li', {
        text: `${nameOf(t.fromMemberId)} pays ${nameOf(t.toMemberId)} ${money(t.amountMinor)}`,
      }))));

  const expenseTable = section('Expenses', h('table', null, [
    h('thead', null, h('tr', null, [
      h('th', { scope: 'col', text: 'Date' }),
      h('th', { scope: 'col', text: 'Title' }),
      h('th', { scope: 'col', text: 'Category' }),
      h('th', { scope: 'col', text: 'Paid by' }),
      h('th.num', { scope: 'col', text: 'Amount' }),
    ])),
    h('tbody', null, expenses.length === 0
      ? h('tr', null, h('td', { colspan: '5', text: 'No expenses recorded.' }))
      : expenses.map((e) => h('tr', null, [
          h('td', { text: dateWithYear(e.date) }),
          h('td', { text: e.title }),
          h('td', { text: categoryLabel(e.category) }),
          h('td', { text: e.payers.map((p) => nameOf(p.memberId)).join(', ') || '—' }),
          h('td.num', { text: money(e.amountMinor) }),
        ]))),
    h('tfoot', null, h('tr', null, [
      h('td', { colspan: '4', text: 'Total' }),
      h('td.num', { text: money(totals.totalSpent) }),
    ])),
  ]));

  return h('div.report', null, [
    h('div.report__head', null, [
      h('div.report__title', { text: group.name }),
      h('div.report__meta', null, [
        h('div', { text: `Generated ${dateWithYear(todayISO())}` }),
        h('div', { text: `Amounts in ${group.currency.code}` }),
      ]),
    ]),
    summary,
    perMember,
    settle,
    expenseTable,
    h('div.report__foot', {
      text: `Generated by Splitly. All figures are in ${group.currency.code}, the currency of this group.`,
    }),
  ]);
}

// --- the on-screen actions --------------------------------------------------

export default function reportView(ctx) {
  const group = ctx.group;

  if (!group) {
    return {
      title: 'Export & share',
      back: '/',
      tab: 'groups',
      content: emptyState({
        iconPath: ICONS.receipt,
        title: 'Group not found',
        message: 'This group may have been deleted, or the link points at something that is not here.',
        action: h('a.btn.btn--primary', { href: '#/', text: 'Back to groups' }),
      }),
    };
  }

  /** Copy, or — when the clipboard is blocked — show the text to copy by hand. */
  const copyOrShow = async (label, text) => {
    if (await copyText(text)) {
      ctx.toast(`${label} copied`, { type: 'success' });
      return;
    }
    const dialog = openSheet({
      title: label,
      body: [
        h('p.small.muted', { text: 'Your browser blocked the clipboard, so here is the text — select it and copy it manually.' }),
        // <pre> keeps the line breaks that make the summary readable in a chat.
        h('pre.code-box', { style: { margin: '0', whiteSpace: 'pre-wrap' }, text }),
      ],
      footer: () => [h('button.btn.btn--primary', { type: 'button', text: 'Done', onclick: () => dialog.close('ok') })],
    });
  };

  const share = async (text) => {
    if (!await shareText(group.name, text)) {
      ctx.toast('Sharing is not available here.', { type: 'error' });
    }
  };

  // Only offer a Share button where there is actually a share sheet; on a
  // desktop browser it would be a button that can only ever fail.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const textButtons = (label, build) => [
    button('Copy', ICONS.copy, () => copyOrShow(label, build()), { primary: true }),
    canShare ? button('Share', ICONS.share, () => share(build())) : null,
  ];

  const download = (label, run) => {
    try {
      run();
      ctx.toast(`${label} downloaded`, { type: 'success' });
    } catch (error) {
      ctx.toast(error?.message || 'That download failed.', { type: 'error' });
    }
  };

  // --- share link. Encoding is async (it compresses), so the card renders
  // with a placeholder and fills itself in.
  const linkSlot = h('div.stack.stack--tight', null, h('p.small.muted', { text: 'Building the link…' }));

  (async () => {
    try {
      const { url, tooLong } = await encodeGroupLink(group);
      // The view may have been replaced while this was running; appending to a
      // detached node is harmless, so there is nothing to cancel.
      clear(linkSlot);
      append(linkSlot, [
        tooLong
          ? h('div.banner.banner--warn', { text: 'This group is too big to fit in a link — messengers and browsers will cut it short. Send the JSON backup below instead.' })
          : null,
        h('div.code-box', { text: url }),
        h('div.row.row--wrap', null, [
          button('Copy link', ICONS.copy, () => copyOrShow('Share link', url), { primary: true }),
          canShare ? button('Share link', ICONS.share, () => share(url)) : null,
        ]),
      ]);
    } catch (error) {
      clear(linkSlot);
      append(linkSlot, h('div.banner.banner--warn', {
        text: error?.message || 'This group could not be turned into a link.',
      }));
    }
  })();

  const actions = h('div.stack.no-print', null, [
    h('p.small.muted', { text: `${group.name} · ${group.expenses.length} ${group.expenses.length === 1 ? 'expense' : 'expenses'} · ${group.members.length} ${group.members.length === 1 ? 'person' : 'people'}` }),

    h('div.section-title', { text: 'Spreadsheets' }),
    card('Expenses CSV', 'Every expense as a row, with a column for what each person paid and owes.', [
      button('Download CSV', ICONS.download,
        () => download('Expenses CSV', () => downloadCsv(`${fileStem(group, 'expenses')}.csv`, expensesCsv(group))),
        { primary: true }),
    ]),
    card('Balances CSV', 'Paid, share and net for each person, plus the payments that would clear it.', [
      button('Download CSV', ICONS.download,
        () => download('Balances CSV', () => downloadCsv(`${fileStem(group, 'balances')}.csv`, balancesCsv(group))),
        { primary: true }),
    ]),

    h('div.section-title', { text: 'Report' }),
    card('Printable report', 'A full report with balances, settle-up and every expense. Choose "Save as PDF" in the print dialog to get a PDF file.', [
      button('Print or save as PDF', ICONS.print, () => window.print(), { primary: true }),
    ]),

    h('div.section-title', { text: 'Text for a chat' }),
    card('Summary', 'Who paid what, and who owes whom. Short enough to paste into a group chat.',
      textButtons('Summary', () => settlementText(group))),
    card('Full summary', 'The same, plus every expense and payment listed out.',
      textButtons('Full summary', () => fullText(group))),

    h('div.section-title', { text: 'Backup and sharing' }),
    card('JSON backup of this group', 'Everything in this group, in a file the app can read back. This is the safe way to move a big group between devices.', [
      button('Download backup', ICONS.download,
        () => download('Backup', () => downloadJson(`${fileStem(group, 'backup')}.json`, buildGroupBackup(group))),
        { primary: true }),
    ]),
    h('div.card', null, [
      h('div.stack.stack--tight', null, [
        h('h3', { text: 'Share this group as a link' }),
        h('p.small.muted', { text: 'The whole group travels inside the link itself — nothing is uploaded to a server.' }),
        linkSlot,
        h('p.small.faint', { text: 'The link carries a snapshot. Whoever opens it gets their own copy in their own browser, and changes either of you make afterwards will not sync.' }),
      ]),
    ]),
  ]);

  return {
    title: 'Export & share',
    subtitle: group.name,
    back: `/g/${group.id}`,
    tab: 'groups',
    content: h('div', null, [actions, buildReport(group)]),
  };
}
