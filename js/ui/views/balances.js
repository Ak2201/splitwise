/**
 * Balances and settling up.
 *
 * Three questions, in the order people actually ask them:
 *   1. where do I stand?          -> net per person
 *   2. who should pay whom?       -> the debt list (simplified or pairwise)
 *   3. what has already been paid? -> payment history
 *
 * The simplified/detailed choice is a persisted setting rather than view-local
 * state: it is a preference about how someone likes to settle, and it would be
 * irritating to re-pick it on every visit.
 */
import { h, append, avatar, icon, ICONS } from '../../util/dom.js';
import { openSheet, confirmAction, emptyState, field } from '../components.js';
import { formatMoney, parseAmount, toDecimalString } from '../../money.js';
import { netBalances, pairwiseDebts, simplifiedDebts } from '../../balance.js';
import { compareISO, formatDate, isValidISO, todayISO } from '../../util/date.js';

export default function balancesView(ctx) {
  const { group, store, navigate, toast } = ctx;

  if (!group) return missingGroup(navigate);

  const currency = group.currency;
  const nameOf = (memberId) => group.members.find((m) => m.id === memberId)?.name || 'Someone';
  const memberOf = (memberId) => group.members.find((m) => m.id === memberId)
    || { id: memberId, name: 'Someone', color: '#8b959d' };

  const net = netBalances(group);
  const simplify = ctx.state.settings.simplifyDebts === true;
  const debts = simplify ? simplifiedDebts(group) : pairwiseDebts(group);
  const settled = debts.length === 0;

  const openSettle = (prefill) => openSettleSheet(ctx, group, prefill);

  const content = h('div.stack.stack--loose', null, [
    balancesSection(group, net, currency),
    h('div.stack', null, [
      h('h2.section-title', { text: 'Settle up' }),
      simplifyToggle(simplify, (value) => store.updateSettings({ simplifyDebts: value })),
      settled
        ? emptyState({
            iconPath: ICONS.check,
            title: 'Everyone is settled up',
            message: group.expenses.length === 0
              ? 'Add an expense and balances will show up here.'
              : 'No one owes anyone anything right now.',
          })
        : h('div.list', null, debts.map((debt) => debtRow(debt, {
            currency, memberOf, nameOf, onSettle: () => openSettle(debt),
          }))),
      group.members.length > 1
        ? h('button.btn.btn--block', {
            type: 'button',
            text: 'Record a payment',
            onclick: () => openSettle(null),
          })
        : null,
    ]),
    historySection(group, { currency, nameOf, store, toast }),
  ]);

  return {
    title: 'Balances',
    subtitle: group.name,
    back: `/g/${group.id}`,
    tab: 'groups',
    content,
  };
}

function missingGroup(navigate) {
  return {
    title: 'Balances',
    tab: 'groups',
    content: emptyState({
      iconPath: ICONS.scale,
      title: 'This group is gone',
      message: 'It was deleted, or the link points at something that is not here.',
      action: h('button.btn.btn--primary', {
        type: 'button',
        text: 'Back to groups',
        onclick: () => navigate('/', { back: true }),
      }),
    }),
  };
}

// --- per-person --------------------------------------------------------------

function balancesSection(group, net, currency) {
  // The bar is scaled against the largest absolute net in the group, so it
  // compares people with each other rather than pretending to be an absolute
  // scale. With everyone at zero there is nothing to compare, so it is dropped.
  const maxAbs = Math.max(0, ...group.members.map((m) => Math.abs(net[m.id] || 0)));

  return h('div.stack', null, [
    h('h2.section-title', { text: 'Balances' }),
    h('div.list', null, group.members.map((member) => {
      const amount = net[member.id] || 0;
      const tone = amount > 0 ? 'pos' : amount < 0 ? 'neg' : 'muted';
      const status = amount > 0
        ? `gets back ${formatMoney(amount, currency)}`
        : amount < 0
          ? `owes ${formatMoney(-amount, currency)}`
          : 'settled up';

      return h('div.list__item.list__item--static', null, [
        avatar(member),
        h('div.list__body', null, [
          h('div.list__title.truncate', { text: member.name }),
          h('div.list__sub.truncate.num', { class: tone, text: status }),
          maxAbs > 0 && amount !== 0
            ? h('div.bar', { style: { marginTop: '6px' } }, h('div.bar__fill', {
                style: {
                  width: `${Math.max(4, Math.round((Math.abs(amount) / maxAbs) * 100))}%`,
                  background: amount < 0 ? 'var(--negative)' : 'var(--positive)',
                },
              }))
            : null,
        ]),
      ]);
    })),
  ]);
}

function simplifyToggle(simplify, onChange) {
  const input = h('input', {
    type: 'checkbox',
    checked: simplify,
    onchange: (event) => onChange(event.target.checked),
  });

  return h('div.stack.stack--tight', null, [
    h('label.checkbox-row', { style: { minHeight: '42px' } }, [
      input,
      h('span.spacer', { text: 'Simplify debts' }),
    ]),
    h('p.small.faint', {
      text: 'Simplified shows the fewest payments; the detailed view shows who owes whom directly from each expense.',
    }),
  ]);
}

function debtRow(debt, { currency, memberOf, nameOf, onSettle }) {
  const from = nameOf(debt.fromMemberId);
  const to = nameOf(debt.toMemberId);
  const amount = formatMoney(debt.amountMinor, currency);

  return h('div.list__item.list__item--static', null, [
    h('div.avatar-stack', null, [
      avatar(memberOf(debt.fromMemberId), 30),
      avatar(memberOf(debt.toMemberId), 30),
    ]),
    h('div.list__body', null, [
      h('div.list__title.truncate', { text: `${from} pays ${to}` }),
      h('div.list__sub.num', { text: amount }),
    ]),
    h('button.btn.btn--sm', {
      type: 'button',
      text: 'Settle up',
      // Every row's button says the same thing, so the label carries the detail.
      'aria-label': `Settle up: ${from} pays ${to} ${amount}`,
      onclick: onSettle,
    }),
  ]);
}

// --- payment history ---------------------------------------------------------

function historySection(group, { currency, nameOf, store, toast }) {
  if (group.settlements.length === 0) return null;

  // Newest first: by calendar date, then by when it was entered, so two
  // payments recorded on the same day keep a stable, sensible order.
  const settlements = group.settlements.slice().sort((a, b) => (
    compareISO(b.date, a.date) || String(b.createdAt).localeCompare(String(a.createdAt))
  ));

  return h('div.stack', null, [
    h('h2.section-title', { text: 'Payments' }),
    h('div.list', null, settlements.map((settlement) => {
      const from = nameOf(settlement.fromMemberId);
      const to = nameOf(settlement.toMemberId);
      const when = formatDate(settlement.date);

      return h('div.list__item.list__item--static', null, [
        h('div.list__body', null, [
          h('div.list__title.truncate', { text: `${from} paid ${to}` }),
          h('div.list__sub.truncate', { text: settlement.notes ? `${when} · ${settlement.notes}` : when }),
        ]),
        h('div.list__end', null, h('div.num', { text: formatMoney(settlement.amountMinor, currency) })),
        h('button.btn.btn--icon', {
          type: 'button',
          'aria-label': `Delete payment from ${from} to ${to}`,
          onclick: async () => {
            const ok = await confirmAction({
              title: 'Delete this payment?',
              message: `${from} paid ${to} ${formatMoney(settlement.amountMinor, currency)} on ${when}. Balances will go back to what they were.`,
              confirmLabel: 'Delete',
              danger: true,
            });
            if (!ok) return;
            store.deleteSettlement(group.id, settlement.id);
            toast('Payment deleted.');
          },
        }, icon(ICONS.trash, { size: 18 })),
      ]);
    })),
  ]);
}

// --- the settle sheet --------------------------------------------------------

/**
 * One sheet for both entry points. "Settle up" on a debt row arrives with
 * `prefill`; "Record a payment" arrives with null and the selects simply start
 * on their defaults — one form to maintain instead of two near-identical ones.
 */
function openSettleSheet(ctx, group, prefill) {
  const { store, toast } = ctx;
  const currency = group.currency;
  const members = group.members;

  const fromSelect = memberSelect(members, prefill?.fromMemberId ?? members[0]?.id);
  const toSelect = memberSelect(members, prefill?.toMemberId ?? members[1]?.id ?? members[0]?.id);

  const amountInput = h('input.amount-input__input', {
    type: 'text',
    inputMode: 'decimal',
    autocomplete: 'off',
    placeholder: '0',
    'aria-label': 'Amount paid',
    value: prefill?.amountMinor ? toDecimalString(prefill.amountMinor, currency.code) : '',
  });
  const amountBox = h('div.amount-input', null, [
    h('span.amount-input__symbol', { text: currency.symbol }),
    amountInput,
  ]);

  const dateInput = h('input.input', { type: 'date', value: todayISO() });
  const notesInput = h('input.input', { type: 'text', maxLength: 200, autocomplete: 'off', placeholder: 'UPI, cash, …' });
  const errorEl = h('p.field__error', { role: 'alert' });

  const submit = () => {
    errorEl.textContent = '';

    const amountMinor = parseAmount(amountInput.value, currency.code);
    if (amountMinor === null || amountMinor <= 0) {
      errorEl.textContent = 'Enter an amount greater than zero.';
      amountInput.focus();
      return;
    }
    if (fromSelect.value === toSelect.value) {
      errorEl.textContent = 'Pick two different people.';
      return;
    }

    const from = members.find((m) => m.id === fromSelect.value);
    const to = members.find((m) => m.id === toSelect.value);
    if (!from || !to) {
      errorEl.textContent = 'Pick who paid and who was paid.';
      return;
    }

    store.addSettlement(group.id, {
      fromMemberId: from.id,
      toMemberId: to.id,
      amountMinor,
      // An empty or half-typed date input reads as '', which would otherwise
      // become "today" deep inside the store — be explicit about it here.
      date: isValidISO(dateInput.value) ? dateInput.value : todayISO(),
      notes: notesInput.value.trim(),
    });

    dialog.close('saved');
    toast(`${from.name} paid ${to.name} ${formatMoney(amountMinor, currency)}.`, { type: 'success' });
  };

  const dialog = openSheet({
    title: 'Record a payment',
    body: h('div.stack', null, [
      // The amount's label cannot use `for`: the control is the .amount-input
      // wrapper, not a labelable element, so the input carries an aria-label.
      field('Amount', amountBox),
      field('Who paid', fromSelect, { id: 'settle-from' }),
      field('Who was paid', toSelect, { id: 'settle-to' }),
      field('Date', dateInput, { id: 'settle-date' }),
      field('Notes', notesInput, { id: 'settle-notes', hint: 'Optional' }),
      errorEl,
    ]),
    footer: () => [
      h('button.btn', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
      h('button.btn.btn--primary', { type: 'button', text: 'Record payment', onclick: submit }),
    ],
  });

  return dialog;
}

function memberSelect(members, selectedId) {
  const select = h('select.select');
  append(select, members.map((m) => h('option', { value: m.id, text: m.name })));
  if (selectedId) select.value = selectedId;
  return select;
}
