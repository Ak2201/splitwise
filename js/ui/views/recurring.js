/**
 * Recurring expense templates: rent, the shared subscription, the monthly
 * cleaner.
 *
 * A template is a stored expense plus a schedule. The expense inside it must
 * balance exactly like any other, or schema.js drops the whole template on the
 * next load — so every path here builds it through resolveSplit.
 */
import { h, append, avatar, icon, ICONS } from '../../util/dom.js';
import { openSheet, confirmAction, emptyState, field } from '../components.js';
import { formatMoney, parseAmount, toDecimalString } from '../../money.js';
import { resolveSplit } from '../../split.js';
import { CATEGORIES } from '../../schema.js';
import { FREQUENCIES, describeFrequency, nextOccurrence } from '../../recurring.js';
import { compareISO, formatDate, isValidISO, relativeDay, todayISO } from '../../util/date.js';

export default function recurringView(ctx) {
  const { group, store, navigate, toast } = ctx;

  if (!group) return missingGroup(navigate);

  const currency = group.currency;
  const openEditor = (template) => openTemplateSheet(ctx, group, template);

  const remove = async (template) => {
    const ok = await confirmAction({
      title: 'Delete this recurring expense?',
      message: `"${template.expense.title}" will stop repeating. Expenses it has already created are kept.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    store.deleteTemplate(group.id, template.id);
    toast('Recurring expense deleted.');
  };

  const togglePaused = (template) => {
    store.updateTemplate(group.id, template.id, { active: !template.active });
    toast(template.active ? 'Paused.' : 'Resumed.');
  };

  const content = group.recurring.length === 0
    ? h('div.stack.stack--loose', null, [
        explainer(),
        emptyState({
          iconPath: ICONS.repeat,
          title: 'Nothing repeats yet',
          message: 'Set up rent, a subscription or anything else that comes round again.',
          action: h('button.btn.btn--primary', {
            type: 'button',
            text: 'Add a recurring expense',
            onclick: () => openEditor(null),
          }),
        }),
      ])
    : h('div.stack', null, [
        explainer(),
        h('div.list', null, group.recurring.map((template) => templateRow(template, {
          group,
          currency,
          onEdit: () => openEditor(template),
          onToggle: () => togglePaused(template),
          onDelete: () => remove(template),
        }))),
      ]);

  return {
    title: 'Recurring',
    subtitle: group.name,
    back: `/g/${group.id}`,
    tab: 'groups',
    content,
    fab: group.recurring.length === 0 ? null : h('button.fab', {
      type: 'button',
      onclick: () => openEditor(null),
    }, [icon(ICONS.plus), h('span', { text: 'Add' })]),
  };
}

function explainer() {
  return h('p.small.faint', {
    text: 'Recurring expenses are added when you open Splitly — there is no server, so nothing is created while the app is closed.',
  });
}

function missingGroup(navigate) {
  return {
    title: 'Recurring',
    tab: 'groups',
    content: emptyState({
      iconPath: ICONS.repeat,
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

// --- rows --------------------------------------------------------------------

function templateRow(template, { group, currency, onEdit, onToggle, onDelete }) {
  const title = template.expense.title;
  const next = template.active ? nextOccurrence(template) : null;

  const schedule = describeFrequency(template.frequency, template.interval);
  // `nextOccurrence` returns null once the end date has passed; the badge
  // already says "Paused", so that line is only interesting while it is running.
  const when = !template.active
    ? null
    : next
      ? `Next: ${formatDate(next)} · ${relativeDay(next)}`
      : 'Finished — the end date has passed';

  const payer = group.members.find((m) => m.id === template.expense.payers[0]?.memberId);

  return h('div.list__item.list__item--static', {
    // A paused template still belongs in the list, just quieter.
    style: template.active ? null : { opacity: '0.62' },
  }, [
    payer ? avatar(payer, 32) : null,
    h('button.btn.btn--ghost.spacer', {
      type: 'button',
      style: { justifyContent: 'flex-start', minWidth: 0, padding: '0', textAlign: 'left' },
      'aria-label': `Edit ${title}`,
      onclick: onEdit,
    }, h('div.list__body', null, [
      h('div.row', null, [
        h('span.list__title.truncate', { text: title }),
        template.active ? null : h('span.badge', { text: 'Paused' }),
      ]),
      h('div.list__sub.truncate', { text: `${formatMoney(template.expense.amountMinor, currency)} · ${schedule}` }),
      when ? h('div.list__sub.truncate', { text: when }) : null,
    ])),
    h('button.btn.btn--sm', {
      type: 'button',
      text: template.active ? 'Pause' : 'Resume',
      // Every row's button says the same word, so the label carries the detail.
      'aria-label': `${template.active ? 'Pause' : 'Resume'} ${title}`,
      onclick: onToggle,
    }),
    h('button.btn.btn--icon', {
      type: 'button',
      'aria-label': `Delete ${title}`,
      onclick: onDelete,
    }, icon(ICONS.trash, { size: 18 })),
  ]);
}

// --- the editor sheet --------------------------------------------------------

/**
 * Add or edit a template.
 *
 * Deliberately equal-split only. The full split UI (exact / percent / shares /
 * adjustment, live remainder, per-payer amounts) lives in the expense form; a
 * second copy of it here would be a lot of surface for a case that barely comes
 * up — a repeating bill is almost always shared evenly. Anything more elaborate
 * can be entered as a one-off expense and edited.
 */
function openTemplateSheet(ctx, group, existing) {
  const { store, toast } = ctx;
  const currency = group.currency;
  const members = group.members;
  const source = existing?.expense;

  const titleInput = h('input.input', {
    type: 'text',
    maxLength: 120,
    autocomplete: 'off',
    placeholder: 'e.g. Rent',
    value: source?.title || '',
  });

  const amountInput = h('input.amount-input__input', {
    type: 'text',
    inputMode: 'decimal',
    autocomplete: 'off',
    placeholder: '0',
    'aria-label': 'Amount',
    value: source?.amountMinor ? toDecimalString(source.amountMinor, currency.code) : '',
  });
  const amountBox = h('div.amount-input', null, [
    h('span.amount-input__symbol', { text: currency.symbol }),
    amountInput,
  ]);

  const categorySelect = h('select.select');
  append(categorySelect, CATEGORIES.map((c) => h('option', { value: c.id, text: `${c.icon} ${c.label}` })));
  categorySelect.value = source?.category || 'general';

  const frequencySelect = h('select.select');
  append(frequencySelect, FREQUENCIES.map((f) => h('option', { value: f.id, text: f.label })));
  frequencySelect.value = existing?.frequency || 'monthly';

  const intervalInput = h('input.input', {
    type: 'number',
    min: 1,
    max: 365,
    step: 1,
    value: String(existing?.interval || 1),
  });

  const startInput = h('input.input', { type: 'date', value: existing?.startDate || todayISO() });
  const endInput = h('input.input', { type: 'date', value: existing?.endDate || '' });

  // A payer whose member was removed from the group can no longer be shown, so
  // fall back to the first member rather than rendering a dangling selection.
  const existingPayer = members.find((m) => m.id === source?.payers[0]?.memberId);
  const payerSelect = h('select.select');
  append(payerSelect, members.map((m) => h('option', { value: m.id, text: m.name })));
  if (existingPayer || members[0]) payerSelect.value = (existingPayer || members[0]).id;

  // Same story for participants: only members that still exist can be ticked.
  // A brand new template starts with everyone in.
  const previous = source ? new Set(Object.keys(source.owedMinor || {})) : null;
  const checkboxes = members.map((member) => {
    const input = h('input', {
      type: 'checkbox',
      checked: previous ? previous.has(member.id) : true,
    });
    return {
      memberId: member.id,
      input,
      row: h('label.checkbox-row', { style: { minHeight: '42px' } }, [
        input,
        avatar(member, 28),
        h('span.truncate', { text: member.name }),
      ]),
    };
  });

  const errorEl = h('p.field__error', { role: 'alert' });

  const submit = () => {
    errorEl.textContent = '';

    const title = titleInput.value.trim();
    if (!title) {
      errorEl.textContent = 'Give it a name.';
      titleInput.focus();
      return;
    }

    const amountMinor = parseAmount(amountInput.value, currency.code);
    if (amountMinor === null || amountMinor <= 0) {
      errorEl.textContent = 'Enter an amount greater than zero.';
      amountInput.focus();
      return;
    }

    const participants = checkboxes
      .filter((c) => c.input.checked)
      .map((c) => ({ memberId: c.memberId, value: 0 }));
    if (participants.length === 0) {
      errorEl.textContent = 'Select at least one person to split between.';
      return;
    }

    const payer = members.find((m) => m.id === payerSelect.value);
    if (!payer) {
      errorEl.textContent = 'Choose who pays.';
      return;
    }

    const startDate = isValidISO(startInput.value) ? startInput.value : todayISO();
    const endDate = isValidISO(endInput.value) ? endInput.value : null;
    if (endDate && compareISO(endDate, startDate) < 0) {
      errorEl.textContent = 'The end date is before the start date.';
      return;
    }

    const interval = Math.min(365, Math.max(1, Math.round(Number(intervalInput.value) || 1)));

    const split = resolveSplit(amountMinor, 'equal', participants);
    if (!split.valid) {
      errorEl.textContent = split.error || 'That split does not add up.';
      return;
    }

    const expense = {
      title,
      category: categorySelect.value,
      notes: source?.notes || '',
      amountMinor,
      payers: [{ memberId: payer.id, amountMinor }],
      split: { mode: 'equal', participants },
      owedMinor: split.owed,
    };

    if (existing) {
      // Moving the start date only re-aims the schedule while nothing has been
      // generated yet. Once expenses exist, rewinding nextDueDate would create
      // duplicates of them on the next open, so the existing cursor stands.
      const patch = { frequency: frequencySelect.value, interval, startDate, endDate, expense };
      if (!existing.lastGeneratedDate) patch.nextDueDate = startDate;
      store.updateTemplate(group.id, existing.id, patch);
    } else {
      store.addTemplate(group.id, {
        active: true,
        frequency: frequencySelect.value,
        interval,
        startDate,
        nextDueDate: startDate,
        endDate,
        lastGeneratedDate: null,
        expense,
      });
    }

    dialog.close('saved');
    toast(existing ? 'Recurring expense updated.' : 'Recurring expense added.', { type: 'success' });
  };

  const dialog = openSheet({
    title: existing ? 'Edit recurring expense' : 'New recurring expense',
    body: h('div.stack', null, [
      field('What for', titleInput, { id: 'rec-title' }),
      // The amount's label cannot use `for`: the control is the .amount-input
      // wrapper, not a labelable element, so the input carries an aria-label.
      field('Amount', amountBox),
      field('Category', categorySelect, { id: 'rec-category' }),
      field('Repeats', frequencySelect, { id: 'rec-frequency' }),
      field('Every', intervalInput, { id: 'rec-interval', hint: 'How many periods between each one, e.g. 2 for every other month.' }),
      field('Starts', startInput, { id: 'rec-start' }),
      field('Ends', endInput, { id: 'rec-end', hint: 'Optional — leave blank to keep going.' }),
      field('Paid by', payerSelect, { id: 'rec-payer' }),
      h('div.field', null, [
        h('span.field__label', { text: 'Split equally between' }),
        h('div', null, checkboxes.map((c) => c.row)),
      ]),
      errorEl,
    ]),
    footer: () => [
      h('button.btn', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
      h('button.btn.btn--primary', { type: 'button', text: existing ? 'Save' : 'Add', onclick: submit }),
    ],
  });

  return dialog;
}
