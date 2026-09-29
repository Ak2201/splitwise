/**
 * /g/:id — the group's ledger: every expense and payment, newest first.
 *
 * The search box and category filter are view-local, not store state: they are
 * a way of looking at the data, not part of it, and persisting them would mean
 * re-opening a group into a filtered view with no obvious way out.
 *
 * They live at module scope so a store-driven repaint (adding an expense, say)
 * does not silently reset them, and they are re-rendered *in place* rather than
 * through ctx.refresh() — repainting the whole view on each keystroke would
 * destroy the search input and take the caret with it.
 */
import { h, append, clear, icon, ICONS, avatar, debounce } from '../../util/dom.js';
import { openSheet, confirmAction, promptText, emptyState, listItem } from '../components.js';
import { formatMoney } from '../../money.js';
import { groupTotals, netBalances } from '../../balance.js';
import { CATEGORIES } from '../../schema.js';
import { formatDate, monthLabel, compareISO } from '../../util/date.js';
import { openExpenseForm } from '../expense-form.js';

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Net rows shown inline before we send the reader to the balances screen. */
const MAX_INLINE_BALANCES = 6;

const filters = { groupId: null, query: '', category: 'all' };

export default function groupView(ctx) {
  const { group, store, navigate, toast } = ctx;

  if (!group) {
    return {
      title: 'Group not found',
      back: '/',
      tab: 'groups',
      content: emptyState({
        iconPath: ICONS.users,
        title: 'Group not found',
        message: 'It may have been deleted on this device, or the link is out of date.',
        action: h('button.btn.btn--primary', {
          type: 'button',
          text: 'Back to groups',
          onclick: () => navigate('/', { back: true }),
        }),
      }),
    };
  }

  // A different group means a different set of expenses; carrying a filter
  // across would show an empty list for no visible reason.
  if (filters.groupId !== group.id) {
    filters.groupId = group.id;
    filters.query = '';
    filters.category = 'all';
  }

  const currency = group.currency || { code: 'INR', symbol: '₹' };
  const totals = groupTotals(group);
  const memberById = new Map(group.members.map((m) => [m.id, m]));
  // A member can only vanish from an expense via a corrupt import, but the row
  // still has to render something rather than "undefined".
  const nameOf = (memberId) => memberById.get(memberId)?.name || 'Someone';

  const addExpense = () => {
    if (group.members.length === 0) {
      toast('Add someone to the group before adding an expense.', { type: 'error' });
      navigate(`/g/${group.id}/members`);
      return;
    }
    openExpenseForm({ group, store });
  };

  // --- list ----------------------------------------------------------------

  const listHost = h('div.stack');

  function searchText(expense) {
    const parts = [
      expense.title,
      expense.notes || '',
      CATEGORY_BY_ID.get(expense.category)?.label || '',
      ...expense.payers.map((p) => nameOf(p.memberId)),
      ...Object.keys(expense.owedMinor || {}).map(nameOf),
    ];
    return parts.join(' ').toLowerCase();
  }

  function visibleEntries() {
    const query = filters.query.trim().toLowerCase();
    const entries = [];

    for (const expense of group.expenses) {
      if (filters.category !== 'all' && (expense.category || 'general') !== filters.category) continue;
      if (query && !searchText(expense).includes(query)) continue;
      entries.push({ kind: 'expense', date: expense.date, seq: expense.createdAt || '', data: expense });
    }

    // Payments have no category, so a category filter is a request to hide them.
    if (filters.category === 'all') {
      for (const settlement of group.settlements) {
        if (query) {
          const text = `${nameOf(settlement.fromMemberId)} ${nameOf(settlement.toMemberId)} ${settlement.notes || ''} payment`;
          if (!text.toLowerCase().includes(query)) continue;
        }
        entries.push({ kind: 'settlement', date: settlement.date, seq: settlement.createdAt || '', data: settlement });
      }
    }

    // Newest day first; within a day, most recently entered first.
    entries.sort((a, b) => compareISO(b.date, a.date) || String(b.seq).localeCompare(String(a.seq)));
    return entries;
  }

  function expenseRow(expense) {
    const category = CATEGORY_BY_ID.get(expense.category) || CATEGORY_BY_ID.get('general');
    const payerNames = expense.payers.map((p) => nameOf(p.memberId));
    const paidBy = payerNames.length === 0 ? 'nobody'
      : payerNames.length === 1 ? payerNames[0]
        : payerNames.length === 2 ? `${payerNames[0]} & ${payerNames[1]}`
          : `${payerNames[0]} & ${payerNames.length - 1} others`;

    const shareCount = Object.keys(expense.owedMinor || {}).length;

    const row = listItem({
      leading: h('span.category-chip', { 'aria-hidden': 'true' }, category.icon),
      title: expense.title,
      subtitle: `Paid by ${paidBy} · ${formatDate(expense.date)}`,
      endTop: formatMoney(expense.amountMinor, currency),
      endBottom: shareCount === 1 ? 'not split' : `split ${shareCount} ways`,
      onClick: () => openExpenseForm({ group, store, expense }),
    });

    if (expense.recurringId) {
      const sub = row.querySelector('.list__end .list__sub');
      if (sub) {
        const mark = icon(ICONS.repeat, { size: 12 });
        mark.style.verticalAlign = '-1px';
        mark.style.marginRight = '4px';
        sub.prepend(mark, h('span.visually-hidden', { text: 'Recurring. ' }));
      }
    }

    return row;
  }

  function settlementRow(settlement) {
    const from = nameOf(settlement.fromMemberId);
    const to = nameOf(settlement.toMemberId);
    const amount = formatMoney(settlement.amountMinor, currency);

    const row = listItem({
      leading: h('span.category-chip', { 'aria-hidden': 'true' }, icon(ICONS.wallet, { size: 18 })),
      title: `${from} paid ${to}`,
      subtitle: settlement.notes
        ? `${formatDate(settlement.date)} · ${settlement.notes}`
        : formatDate(settlement.date),
      endTop: amount,
      endBottom: 'payment',
      onClick: async () => {
        const ok = await confirmAction({
          title: 'Delete this payment?',
          message: `${from} paid ${to} ${amount}. Deleting it puts that back into the balances.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (ok) store.deleteSettlement(group.id, settlement.id);
      },
    });

    // Payments are bookkeeping, not spending — they should read as quieter
    // than the expenses they cancel out.
    row.classList.add('muted');
    return row;
  }

  function clearFilters() {
    filters.query = '';
    filters.category = 'all';
    searchInput.value = '';
    categoryFilter.value = 'all';
    renderList();
  }

  function renderList() {
    clear(listHost);
    const entries = visibleEntries();

    if (entries.length === 0) {
      append(listHost, emptyState({
        iconPath: ICONS.search,
        title: 'Nothing matches',
        message: 'Try a different search or category.',
        action: h('button.btn', { type: 'button', text: 'Clear filters', onclick: clearFilters }),
      }));
      return;
    }

    let month = null;
    let list = null;
    for (const entry of entries) {
      const key = entry.date.slice(0, 7);
      if (key !== month) {
        month = key;
        list = h('div.list');
        append(list, h('div.list__group-label', { text: monthLabel(entry.date) }));
        append(listHost, list);
      }
      append(list, entry.kind === 'expense' ? expenseRow(entry.data) : settlementRow(entry.data));
    }
  }

  // --- filters -------------------------------------------------------------

  const searchInput = h('input.input', {
    type: 'search',
    value: filters.query,
    placeholder: 'Search expenses',
    'aria-label': 'Search expenses',
    autocomplete: 'off',
  });

  const applyQuery = debounce(() => {
    filters.query = searchInput.value;
    renderList();
  }, 180);
  searchInput.addEventListener('input', applyQuery);

  const categoryFilter = h('select.select', { 'aria-label': 'Filter by category' }, [
    h('option', { value: 'all', text: 'All categories' }),
    ...CATEGORIES.map((c) => h('option', { value: c.id, text: `${c.icon} ${c.label}` })),
  ]);
  categoryFilter.value = filters.category;
  categoryFilter.addEventListener('change', () => {
    filters.category = categoryFilter.value;
    renderList();
  });

  const filterRow = h('div.row.row--wrap', null, [
    h('div', { style: { flex: '2 1 180px', minWidth: '0' } }, searchInput),
    h('div', { style: { flex: '1 1 150px', minWidth: '0' } }, categoryFilter),
  ]);

  // --- summary -------------------------------------------------------------

  function summaryCard() {
    const nets = netBalances(group);
    const shown = group.members.slice(0, MAX_INLINE_BALANCES);

    const balanceRows = shown.map((m) => {
      const net = nets[m.id] || 0;
      const tone = net > 0 ? 'pos' : net < 0 ? 'neg' : 'faint';
      return h('div.row', null, [
        avatar(m, 24),
        h('span.truncate.spacer', { text: m.name }),
        h(`span.small.num.${tone}`, {
          text: net === 0 ? 'settled' : formatMoney(net, currency, { signed: true }),
        }),
      ]);
    });

    if (group.members.length > shown.length) {
      balanceRows.push(h('a.btn.btn--sm.btn--ghost', {
        href: `#/g/${group.id}/balances`,
        text: `See all ${group.members.length} balances`,
      }));
    }

    return h('div.card', null, h('div.stack', null, [
      h('div.summary', null, [
        h('div.summary__cell', null, [
          h('div.summary__label', { text: 'Total spent' }),
          h('div.summary__value', { text: formatMoney(totals.totalSpent, currency) }),
        ]),
        h('div.summary__cell', null, [
          h('div.summary__label', { text: 'Expenses' }),
          h('div.summary__value', { text: String(totals.expenseCount) }),
        ]),
      ]),
      totals.expenseCount > 0 || group.settlements.length > 0
        ? h('div.stack.stack--tight', null, balanceRows)
        : null,
    ]));
  }

  // --- header actions ------------------------------------------------------

  function openGroupMenu() {
    const go = (path) => { sheet.close(); navigate(path); };

    const rename = async () => {
      sheet.close();
      const name = await promptText({
        title: 'Rename group',
        label: 'Group name',
        value: group.name,
        confirmLabel: 'Save',
      });
      if (name) store.updateGroup(group.id, { name });
    };

    const remove = async () => {
      sheet.close();
      const ok = await confirmAction({
        title: 'Delete group?',
        message: `"${group.name}" and its ${totals.expenseCount} ${totals.expenseCount === 1 ? 'expense' : 'expenses'} will be deleted from this device. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      // Leave first: deleting while this view is still routed makes the store's
      // repaint render the "group not found" screen for a frame before the hash
      // change lands.
      navigate('/', { back: true });
      store.deleteGroup(group.id);
    };

    const deleteRow = listItem({ title: 'Delete group', onClick: remove });
    // The only destructive row here; colour it rather than inventing a
    // listItem variant that nothing else in the app needs.
    deleteRow.querySelector('.list__title').classList.add('neg');

    const sheet = openSheet({
      title: 'Group options',
      body: h('div.list', null, [
        listItem({
          title: 'Members',
          subtitle: `${group.members.length} ${group.members.length === 1 ? 'person' : 'people'}`,
          chevron: true,
          onClick: () => go(`/g/${group.id}/members`),
        }),
        listItem({
          title: 'Recurring',
          subtitle: group.recurring.length === 0
            ? 'No repeating expenses'
            : `${group.recurring.length} ${group.recurring.length === 1 ? 'template' : 'templates'}`,
          chevron: true,
          onClick: () => go(`/g/${group.id}/recurring`),
        }),
        listItem({
          title: 'Export & share',
          subtitle: 'CSV, backup, share link',
          chevron: true,
          onClick: () => go(`/g/${group.id}/report`),
        }),
        listItem({ title: 'Rename group', onClick: rename }),
        deleteRow,
      ]),
    });
  }

  const actions = [
    h('a.btn.btn--icon', {
      href: `#/g/${group.id}/balances`,
      'aria-label': 'Balances',
      title: 'Balances',
    }, icon(ICONS.scale)),
    h('button.btn.btn--icon', {
      type: 'button',
      'aria-label': 'Group options',
      title: 'Group options',
      onclick: openGroupMenu,
    }, icon(ICONS.settings)),
  ];

  // --- assemble ------------------------------------------------------------

  const hasAnything = group.expenses.length > 0 || group.settlements.length > 0;
  if (hasAnything) renderList();

  const memberCount = group.members.length;
  const content = h('div.stack.stack--loose', null, [
    memberCount === 0
      ? h('div.banner.banner--info', null, [
          h('span.spacer', { text: 'This group has nobody in it yet.' }),
          h('a.btn.btn--sm', { href: `#/g/${group.id}/members`, text: 'Add people' }),
        ])
      : null,

    summaryCard(),

    hasAnything ? filterRow : null,

    hasAnything ? listHost : emptyState({
      iconPath: ICONS.receipt,
      title: 'No expenses yet',
      message: 'Add the first one and Splitly works out who owes what.',
      action: h('button.btn.btn--primary', {
        type: 'button',
        text: 'Add an expense',
        onclick: addExpense,
      }),
    }),
  ]);

  return {
    title: group.name,
    subtitle: `${memberCount} ${memberCount === 1 ? 'person' : 'people'} · ${formatMoney(totals.totalSpent, currency)} spent`,
    back: '/',
    tab: 'groups',
    actions,
    content,
    fab: h('button.fab', { type: 'button', onclick: addExpense }, [
      icon(ICONS.plus),
      h('span', { text: 'Add expense' }),
    ]),
  };
}
