/**
 * The home screen: every group you have, newest activity first.
 *
 * Also owns the "new group" sheet, because creating a group is the only way in
 * and this is the only screen that can be reached with none of them.
 */
import { h, append, clear, icon, ICONS } from '../../util/dom.js';
import { openSheet, emptyState, listItem, field, segmented } from '../components.js';
import { formatMoney, CURRENCIES, currencyByCode } from '../../money.js';
import { groupTotals } from '../../balance.js';
import { GROUP_TYPES } from '../../schema.js';

const DEFAULT_CURRENCY = 'INR';

function typeIcon(typeId) {
  return GROUP_TYPES.find((t) => t.id === typeId)?.icon || GROUP_TYPES[GROUP_TYPES.length - 1].icon;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The create-group form, as a modal sheet. */
function openCreateSheet(ctx) {
  let type = GROUP_TYPES[0].id;

  // --- name
  const nameInput = h('input.input', {
    type: 'text',
    placeholder: 'Goa trip',
    maxLength: 80,
    autocomplete: 'off',
    enterkeyhint: 'next',
  });
  const nameField = field('Group name', nameInput, { id: 'new-group-name' });
  const nameError = h('span.field__error', { role: 'alert', hidden: true });
  append(nameField, nameError);
  nameInput.addEventListener('input', () => {
    nameInput.removeAttribute('aria-invalid');
    nameError.hidden = true;
  });

  // --- type. The segmented control is stateless, so it is rebuilt on each
  // pick rather than reaching into its buttons to move aria-pressed.
  const typeSlot = h('div');
  const paintType = () => {
    clear(typeSlot);
    append(typeSlot, segmented(
      GROUP_TYPES.map((t) => ({ id: t.id, label: `${t.icon} ${t.label}` })),
      type,
      (picked) => { type = picked; paintType(); },
      { label: 'Group type' },
    ));
  };
  paintType();

  // --- currency
  const currencySelect = h('select.select');
  for (const c of CURRENCIES) {
    append(currencySelect, h('option', {
      value: c.code,
      selected: c.code === DEFAULT_CURRENCY,
      text: `${c.symbol}  ${c.code} — ${c.name}`,
    }));
  }

  // --- members
  const memberList = h('div.stack.stack--tight');
  const memberError = h('span.field__error', { role: 'alert', hidden: true });

  function addMemberRow(value = '') {
    const input = h('input.input', {
      type: 'text',
      value,
      placeholder: 'Name',
      maxLength: 80,
      autocomplete: 'off',
    });
    input.addEventListener('input', () => { memberError.hidden = true; });

    const row = h('div.row', null, [
      input,
      h('button.btn.btn--icon', {
        type: 'button',
        'aria-label': 'Remove this person',
        onclick: () => {
          row.remove();
          // Never leave the form with nothing to type into.
          if (memberList.children.length === 0) addMemberRow();
        },
      }, icon(ICONS.close, { size: 18 })),
    ]);

    append(memberList, row);
    return input;
  }

  // Two rows to start: the smallest split that means anything.
  addMemberRow();
  addMemberRow();

  const addPersonBtn = h('button.btn.btn--sm', {
    type: 'button',
    onclick: () => addMemberRow().focus(),
  }, [icon(ICONS.plus, { size: 16 }), h('span', { text: 'Add person' })]);

  const memberNames = () => [...memberList.querySelectorAll('input')]
    .map((input) => input.value.trim())
    .filter(Boolean);

  const submit = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameError.textContent = 'Give the group a name.';
      nameError.hidden = false;
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }

    const names = memberNames();
    if (names.length === 0) {
      memberError.textContent = 'Add at least one person.';
      memberError.hidden = false;
      memberList.querySelector('input')?.focus();
      return;
    }

    const currency = currencyByCode(currencySelect.value);
    const id = ctx.store.createGroup({
      name,
      type,
      currency: { code: currency.code, symbol: currency.symbol },
      memberNames: names,
    });

    dialog.close('created');
    ctx.navigate(`/g/${id}`);
  };

  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); memberList.querySelector('input')?.focus(); }
  });

  const dialog = openSheet({
    title: 'New group',
    body: [
      h('div.stack', null, [
        nameField,
        field('What is it for?', typeSlot),
        field('Currency', currencySelect, { id: 'new-group-currency' }),
        h('div.field', null, [
          h('span.field__label', { text: 'Who is in it?' }),
          memberList,
          memberError,
          h('div.row', null, [addPersonBtn]),
          h('span.field__hint', { text: 'You can add or rename people later.' }),
        ]),
      ]),
    ],
    footer: () => [
      h('button.btn', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
      h('button.btn.btn--primary', { type: 'button', text: 'Create group', onclick: submit }),
    ],
  });

  nameInput.focus();
}

export default function groupsView(ctx) {
  const groups = Object.values(ctx.state.groups)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  let content;
  if (groups.length === 0) {
    content = emptyState({
      iconPath: ICONS.users,
      title: 'Welcome to Splitly',
      message: 'Split expenses with the people you travel, live and eat with. '
        + 'Everything you add stays in this browser — there is no account and nothing is uploaded.',
      action: h('div.stack.stack--tight', null, [
        h('button.btn.btn--primary', {
          type: 'button',
          text: 'Create a group',
          onclick: () => openCreateSheet(ctx),
        }),
        h('a.btn', { href: '#/settings', text: 'Import from a link or backup' }),
      ]),
    });
  } else {
    const list = h('div.list');
    for (const group of groups) {
      const totals = groupTotals(group);
      append(list, listItem({
        leading: h('span.category-chip', { text: typeIcon(group.type) }),
        title: group.name,
        subtitle: `${plural(group.members.length, 'person', 'people')} · ${formatMoney(totals.totalSpent, group.currency)}`,
        endTop: String(totals.expenseCount),
        endBottom: totals.expenseCount === 1 ? 'expense' : 'expenses',
        onClick: () => ctx.navigate(`/g/${group.id}`),
        chevron: true,
      }));
    }
    content = h('div.stack', null, [list]);
  }

  return {
    title: 'Splitly',
    tab: 'groups',
    content,
    fab: h('button.fab', {
      type: 'button',
      'aria-label': 'New group',
      onclick: () => openCreateSheet(ctx),
    }, [icon(ICONS.plus, { size: 22 }), h('span', { text: 'New group' })]),
  };
}
