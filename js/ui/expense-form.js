/**
 * The add / edit expense sheet.
 *
 * Not a view: any screen that can create an expense opens this. It owns a small
 * amount of draft state and only ever commits through the store, so a cancelled
 * edit leaves nothing behind.
 *
 * Rendering strategy: the sheet is built once and then *mutated in place*. The
 * member rows in particular are never rebuilt while the sheet is open, because
 * rebuilding them mid-edit would drop focus and the caret out of whatever input
 * the user is typing in.
 */
import { h, append, clear, avatar } from '../util/dom.js';
import { openSheet, confirmAction, field, segmented, toast } from './components.js';
import { parseAmount, formatMoney, toDecimalString } from '../money.js';
import {
  resolveSplit, resolvePayers, seedParticipants, SPLIT_MODES, PERCENT_SCALE,
} from '../split.js';
import { CATEGORIES, LIMITS } from '../schema.js';
import { todayISO } from '../util/date.js';

// Only ever one sheet at a time, but ids still need to be unique across the
// lifetime of the page so a stale label can never point at a live input.
let formSeq = 0;

const MODE_BY_ID = new Map(SPLIT_MODES.map((m) => [m.id, m]));

/** Percent values are hundredths: 3333 -> "33.33", 5000 -> "50". */
function percentToText(value) {
  if (!Number.isFinite(value)) return '';
  return String(Math.round(value) / PERCENT_SCALE);
}

function percentFromText(text) {
  const n = Number(String(text).replace(',', '.').trim());
  return Number.isFinite(n) ? Math.round(n * PERCENT_SCALE) : 0;
}

function integerFromText(text) {
  const n = Number(String(text).trim());
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** CSS keys off `aria-invalid="true"`, so a bare attribute is not enough. */
function setInvalid(el, invalid) {
  if (invalid) el.setAttribute('aria-invalid', 'true');
  else el.removeAttribute('aria-invalid');
}

/**
 * @param {object}   opts
 * @param {object}   opts.group    the group the expense belongs to
 * @param {object}   opts.store    the store module
 * @param {object?}  opts.expense  existing expense to edit, or null to add
 * @param {Function?} opts.onSaved called after a successful save or delete
 */
export function openExpenseForm({ group, store, expense = null, onSaved }) {
  const members = group.members;
  if (members.length === 0) {
    toast('Add someone to the group first.', { type: 'error' });
    return null;
  }

  const editing = expense !== null;
  const code = group.currency?.code || 'INR';
  const currency = group.currency || { code, symbol: code };
  const uid = `ef${(formSeq += 1)}`;
  const memberIds = members.map((m) => m.id);
  const memberById = new Map(members.map((m) => [m.id, m]));

  // --- draft state ---------------------------------------------------------

  // An expense can only reference current members (schema.js drops the rest),
  // but guard anyway so a half-migrated group cannot produce a broken form.
  const existingParticipants = (expense?.split?.participants || [])
    .filter((p) => memberById.has(p.memberId));
  const existingPayers = (expense?.payers || []).filter((p) => memberById.has(p.memberId));

  let amountMinor = expense ? expense.amountMinor : 0;
  let mode = MODE_BY_ID.has(expense?.split?.mode) ? expense.split.mode : 'equal';

  const selected = new Set(
    existingParticipants.length > 0 ? existingParticipants.map((p) => p.memberId) : memberIds,
  );

  /** memberId -> value in the *current* mode's unit (minor units, hundredths of a percent, or shares). */
  const values = {};
  for (const id of memberIds) values[id] = 0;
  for (const p of existingParticipants) values[p.memberId] = p.value;

  /**
   * Share counts the user has actually chosen. Kept apart from `values` because
   * seedParticipants defaults a *missing* entry to one share, and handing it a
   * map of zeros (what `equal` leaves behind) would seed a split of nothing.
   */
  const shareMemory = {};
  if (mode === 'shares') {
    for (const p of existingParticipants) shareMemory[p.memberId] = p.value;
  }

  // A brand-new expense starts on `equal`, which needs no values; an edited one
  // arrives with values already consistent with its mode.
  if (!editing) reseed(mode);

  /** memberId -> minor units, only meaningful while `multiPayer` is on. */
  const payerValues = {};
  for (const id of memberIds) payerValues[id] = 0;
  for (const p of existingPayers) payerValues[p.memberId] = p.amountMinor;

  let multiPayer = existingPayers.length > 1;
  let singlePayerId = existingPayers[0]?.memberId || memberIds[0];
  let amountTouched = false;
  let titleTouched = false;

  /**
   * Whether the user has hand-entered split values in the current mode.
   *
   * Re-seeding overwrites every row with an even split, so it must only ever
   * happen to values the app itself put there. Blindly re-seeding on each
   * amount keystroke silently turned a deliberate 700/300 back into 500/500
   * while still reading "All set" - a wrong bill, saved with no warning.
   */
  let valuesTouched = editing && (mode === 'exact' || mode === 'percent');

  function selectedIds() {
    return memberIds.filter((id) => selected.has(id));
  }

  function participants() {
    return selectedIds().map((memberId) => ({ memberId, value: values[memberId] ?? 0 }));
  }

  function reseed(targetMode) {
    const previous = targetMode === 'shares' ? shareMemory : values;
    const seeded = seedParticipants(amountMinor, targetMode, selectedIds(), previous);
    for (const p of seeded) values[p.memberId] = p.value;
  }

  function buildPayers() {
    if (!multiPayer) return [{ memberId: singlePayerId, amountMinor }];
    return memberIds
      .filter((id) => (payerValues[id] || 0) !== 0)
      .map((memberId) => ({ memberId, amountMinor: payerValues[memberId] }));
  }

  // --- amount --------------------------------------------------------------

  const amountInput = h('input.amount-input__input', {
    type: 'text',
    inputmode: 'decimal',
    id: `${uid}-amount`,
    placeholder: '0',
    autocomplete: 'off',
    enterkeyhint: 'done',
    'aria-describedby': `${uid}-amount-error`,
    value: editing ? toDecimalString(expense.amountMinor, code) : '',
  });

  const amountError = h('span.field__error', { id: `${uid}-amount-error`, role: 'alert' });
  amountError.hidden = true;

  const amountField = h('div.field', null, [
    h('label.field__label', { text: 'Amount', for: `${uid}-amount` }),
    h('div.amount-input', null, [
      h('span.amount-input__symbol', { text: currency.symbol || code, 'aria-hidden': 'true' }),
      amountInput,
    ]),
    amountError,
  ]);

  amountInput.addEventListener('input', () => {
    // "Touched" means typed in, not merely focused: the sheet autofocuses this
    // field, and tabbing straight past it should not turn a blank form red.
    amountTouched = true;
    const parsed = parseAmount(amountInput.value, code);
    const next = parsed === null ? 0 : Math.max(0, parsed);
    if (next === amountMinor) { update(); return; }
    amountMinor = next;

    // Percentages are independent of the total, so the total changing must not
    // touch them at all. Exact amounts are tied to it, but only re-seed while
    // the figures are still the app's own even split - once the user has typed
    // their own, leave them and let the "left to assign" line show the gap.
    if (mode === 'exact' && !valuesTouched) reseed(mode);

    // A single non-zero payer is almost always "the payer covers everything",
    // so keep them in step with the total rather than forcing a re-type.
    if (multiPayer) {
      const nonZero = memberIds.filter((id) => (payerValues[id] || 0) !== 0);
      if (nonZero.length === 1) payerValues[nonZero[0]] = amountMinor;
    }

    syncValueInputs();
    syncPayerInputs();
    update();
  });

  // --- title, category, date, notes ---------------------------------------

  const titleInput = h('input.input', {
    type: 'text',
    maxLength: 120,
    placeholder: 'Dinner, cab, groceries…',
    autocomplete: 'off',
    enterkeyhint: 'done',
    value: expense?.title || '',
  });
  titleInput.addEventListener('input', () => { titleTouched = true; update(); });

  const categorySelect = h('select.select', null, CATEGORIES.map((c) => h('option', {
    value: c.id,
    text: `${c.icon} ${c.label}`,
  })));
  categorySelect.value = CATEGORIES.some((c) => c.id === expense?.category)
    ? expense.category
    : 'general';

  const dateInput = h('input.input', { type: 'date', value: expense?.date || todayISO() });

  const notesInput = h('textarea.textarea', {
    maxLength: 1000,
    placeholder: 'Optional',
    rows: 2,
    value: expense?.notes || '',
  });

  // --- paid by -------------------------------------------------------------

  const payerHost = h('div.stack.stack--tight');
  const payerRemaining = h('div.remaining');
  /** memberId -> the money input for that payer, while `multiPayer` is on. */
  const payerInputs = new Map();

  const multiPayerToggle = h('input', { type: 'checkbox', checked: multiPayer });
  multiPayerToggle.addEventListener('change', () => {
    multiPayer = multiPayerToggle.checked;
    if (multiPayer) {
      // Carry the single payer over so the sheet stays valid across the switch.
      const alreadySet = memberIds.some((id) => (payerValues[id] || 0) !== 0);
      if (!alreadySet) {
        for (const id of memberIds) payerValues[id] = 0;
        payerValues[singlePayerId] = amountMinor;
      }
    } else {
      const biggest = memberIds
        .slice()
        .sort((a, b) => (payerValues[b] || 0) - (payerValues[a] || 0))[0];
      if ((payerValues[biggest] || 0) > 0) singlePayerId = biggest;
    }
    renderPayers();
    update();
  });

  // The "Paid by" heading above this is a section label, not a <label>, so the
  // select needs its own accessible name.
  const singlePayerSelect = h('select.select', { 'aria-label': 'Who paid' }, members.map((m) => h('option', {
    value: m.id,
    text: m.name,
  })));
  singlePayerSelect.addEventListener('change', () => {
    singlePayerId = singlePayerSelect.value;
    update();
  });

  function renderPayers() {
    clear(payerHost);
    payerInputs.clear();

    if (!multiPayer) {
      singlePayerSelect.value = memberById.has(singlePayerId) ? singlePayerId : memberIds[0];
      singlePayerId = singlePayerSelect.value;
      append(payerHost, singlePayerSelect);
      return;
    }

    for (const m of members) {
      const input = h('input.input', {
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        'aria-label': `Amount paid by ${m.name}`,
        value: (payerValues[m.id] || 0) === 0 ? '' : toDecimalString(payerValues[m.id], code),
      });
      input.addEventListener('input', () => {
        payerValues[m.id] = input.value.trim() === '' ? 0 : (parseAmount(input.value, code) ?? 0);
        update();
      });
      payerInputs.set(m.id, input);

      append(payerHost, h('div.split-row', null, [
        h('div.row.spacer', { style: { minWidth: '0' } }, [
          avatar(m, 28),
          h('span.truncate', { text: m.name }),
        ]),
        h('div.split-row__value', null, input),
      ]));
    }
    append(payerHost, payerRemaining);
  }

  function syncPayerInputs() {
    for (const [memberId, input] of payerInputs) {
      const next = (payerValues[memberId] || 0) === 0 ? '' : toDecimalString(payerValues[memberId], code);
      if (input.value !== next && document.activeElement !== input) input.value = next;
    }
  }

  // --- split ---------------------------------------------------------------

  const modeHint = h('span.field__hint');
  const splitRowsHost = h('div');
  const splitRemaining = h('div.remaining');

  /** memberId -> { checkbox, valueWrap, valueInput, shareEl } */
  const rows = new Map();

  for (const m of members) {
    const checkbox = h('input', {
      type: 'checkbox',
      checked: selected.has(m.id),
      'aria-label': `Include ${m.name} in the split`,
    });
    const shareEl = h('span.small.faint.num');
    const valueInput = h('input.input', { type: 'text', autocomplete: 'off' });
    const valueWrap = h('div.split-row__value', null, valueInput);

    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(m.id);
      else selected.delete(m.id);
      // Adding or removing someone changes what an even split means, but the
      // same rule applies: never overwrite figures the user typed themselves.
      if ((mode === 'exact' || mode === 'percent') && !valuesTouched) {
        reseed(mode);
      } else if (!checkbox.checked) {
        // A hand-entered value belonging to someone no longer in the split
        // would otherwise keep counting toward the total.
        values[m.id] = 0;
      }
      syncValueInputs();
      update();
    });

    valueInput.addEventListener('input', () => {
      const raw = valueInput.value;
      valuesTouched = true;
      if (mode === 'percent') {
        values[m.id] = percentFromText(raw);
      } else if (mode === 'shares') {
        values[m.id] = integerFromText(raw);
        shareMemory[m.id] = values[m.id];
      } else {
        values[m.id] = raw.trim() === '' ? 0 : (parseAmount(raw, code) ?? 0);
      }
      update();
    });

    rows.set(m.id, { checkbox, valueWrap, valueInput, shareEl });

    append(splitRowsHost, h('div.split-row', null, [
      h('label.checkbox-row.spacer', { style: { minWidth: '0' } }, [
        checkbox,
        avatar(m, 28),
        h('span.truncate', { text: m.name }),
        h('span.spacer'),
        shareEl,
      ]),
      valueWrap,
    ]));
  }

  const modeSegmented = segmented(SPLIT_MODES, mode, (id) => {
    if (id === mode) return;
    mode = id;
    // Switching mode reinterprets every figure, so seeding a fresh valid split
    // is right here - and the new values are the app's, not the user's again.
    valuesTouched = false;
    reseed(mode);
    modeSegmented.querySelectorAll('.segmented__option').forEach((option, i) => {
      option.setAttribute('aria-pressed', String(SPLIT_MODES[i].id === mode));
    });
    syncValueInputs();
    update();
  }, { label: 'How to split' });

  /** Push `values` into the inputs and reshape them for the current mode. */
  function syncValueInputs() {
    const hideValues = mode === 'equal';
    modeHint.textContent = MODE_BY_ID.get(mode)?.hint || '';

    for (const [memberId, row] of rows) {
      const isIn = selected.has(memberId);
      row.checkbox.checked = isIn;
      row.valueWrap.hidden = hideValues || !isIn;
      if (hideValues || !isIn) continue;

      const input = row.valueInput;
      if (mode === 'percent') {
        input.inputMode = 'decimal';
        input.placeholder = '0';
        input.setAttribute('aria-label', `Percentage for ${memberById.get(memberId).name}`);
      } else if (mode === 'shares') {
        input.inputMode = 'numeric';
        input.placeholder = '1';
        input.setAttribute('aria-label', `Shares for ${memberById.get(memberId).name}`);
      } else {
        input.inputMode = 'decimal';
        input.placeholder = '0';
        input.setAttribute('aria-label', mode === 'adjustment'
          ? `Extra amount for ${memberById.get(memberId).name}`
          : `Amount owed by ${memberById.get(memberId).name}`);
      }

      const value = values[memberId] ?? 0;
      const next = mode === 'percent' ? percentToText(value)
        : mode === 'shares' ? String(value)
          : toDecimalString(value, code);
      // Never stomp on the field the user is typing in.
      if (input.value !== next && document.activeElement !== input) input.value = next;
    }
  }

  // --- validation and live feedback ---------------------------------------

  const saveBtn = h('button.btn.btn--primary', {
    type: 'button',
    text: editing ? 'Save changes' : 'Add expense',
  });

  function setRemaining(el, ok, message, amount) {
    el.className = `remaining ${ok ? 'remaining--ok' : 'remaining--off'}`;
    clear(el);
    append(el, [
      h('span', { text: message }),
      amount === null ? null : h('span.num', { text: amount }),
    ]);
  }

  function update() {
    const parsed = parseAmount(amountInput.value, code);
    // The store accepts anything, but schema.js clamps an out-of-range amount
    // to zero on the next load and then drops the expense for not balancing.
    // Catching it here turns a fat-fingered extra zero into a visible error
    // instead of an expense that disappears after a reload.
    const tooLarge = parsed !== null && Math.abs(parsed) > LIMITS.amount;
    const amountOk = parsed !== null && parsed > 0 && !tooLarge;

    amountError.hidden = !(amountTouched && !amountOk);
    amountError.textContent = tooLarge
      ? `That is larger than this app can track (max ${formatMoney(LIMITS.amount, currency)}).`
      : parsed === null || parsed === 0
        ? 'Enter an amount greater than zero.'
        : 'Amount cannot be negative.';
    setInvalid(amountInput, amountTouched && !amountOk);

    const titleOk = titleInput.value.trim().length > 0;
    setInvalid(titleInput, titleTouched && !titleOk);

    const payerCheck = resolvePayers(amountMinor, buildPayers());
    if (multiPayer) {
      const left = payerCheck.remainingMinor;
      setRemaining(
        payerRemaining,
        payerCheck.valid,
        payerCheck.valid ? 'All set' : left > 0 ? 'Still to account for' : 'Over the total by',
        payerCheck.valid ? null : formatMoney(Math.abs(left), currency),
      );
    }

    const split = resolveSplit(amountMinor, mode, participants());
    const left = split.remainingMinor;
    if (!amountOk) {
      // Every mode "balances" against a total of nothing, so saying "All set"
      // here would be a lie the user then has to work out for themselves.
      setRemaining(splitRemaining, false, 'Enter an amount to split', null);
    } else if (split.valid) {
      setRemaining(splitRemaining, true, 'All set', null);
    } else if (split.error && left === 0) {
      setRemaining(splitRemaining, false, split.error, null);
    } else {
      setRemaining(
        splitRemaining,
        false,
        left > 0 ? 'Left to assign' : 'Over the total by',
        formatMoney(Math.abs(left), currency),
      );
    }

    // In equal mode the per-person figure is the only feedback there is, so
    // show it on the row itself rather than only in the remaining bar. With no
    // total yet it would just be a column of zeroes, so hold it back.
    const showShares = mode === 'equal' && amountOk;
    for (const [memberId, row] of rows) {
      const owed = split.owed[memberId];
      row.shareEl.textContent = showShares && selected.has(memberId) && owed !== undefined
        ? formatMoney(owed, currency)
        : '';
    }

    saveBtn.disabled = !(amountOk && titleOk && payerCheck.valid && split.valid);
  }

  // --- save / delete -------------------------------------------------------

  function save() {
    const total = parseAmount(amountInput.value, code);
    if (total === null || total <= 0) return;

    const parts = participants();
    const split = resolveSplit(total, mode, parts);
    const payers = buildPayers();
    if (!split.valid || !resolvePayers(total, payers).valid) return;

    const payload = {
      title: titleInput.value.trim().slice(0, 120),
      category: categorySelect.value,
      notes: notesInput.value.trim().slice(0, 1000),
      date: dateInput.value || todayISO(),
      amountMinor: total,
      payers,
      split: { mode, participants: parts },
      owedMinor: split.owed,
    };
    // A generated expense keeps its link to the template even after an edit,
    // so the list can still flag it as recurring.
    if (expense?.recurringId) payload.recurringId = expense.recurringId;

    // This sheet is a snapshot taken when it opened, and the group underneath
    // it can change while it is open - another tab removing someone is the
    // realistic case. Saving a reference to a member who no longer exists
    // writes an expense that no longer balances once schema.js filters them
    // out, and it is then dropped on the next load. Re-check against live
    // state and refuse rather than write something that will quietly vanish.
    const live = store.getGroup(group.id);
    if (!live) {
      toast('That group no longer exists on this device.', { type: 'error' });
      return;
    }
    const liveIds = new Set(live.members.map((m) => m.id));
    const missing = [
      ...payload.payers.map((p) => p.memberId),
      ...Object.keys(payload.owedMinor),
    ].filter((id) => !liveIds.has(id));

    if (missing.length > 0) {
      const names = [...new Set(missing)]
        .map((id) => memberById.get(id)?.name)
        .filter(Boolean);
      toast(
        names.length > 0
          ? `${names.join(' and ')} was removed from this group somewhere else. Reopen this expense to start again.`
          : 'Someone in this split was removed from the group. Reopen this expense to start again.',
        { type: 'error' },
      );
      return;
    }

    try {
      if (editing) store.updateExpense(group.id, expense.id, payload);
      else store.addExpense(group.id, payload);
    } catch (error) {
      toast(error?.message || 'That expense could not be saved.', { type: 'error' });
      return;
    }

    onSaved?.();
    dialog.close('saved');
  }

  saveBtn.addEventListener('click', save);

  // Enter anywhere in a single-line field saves, as long as the draft is valid.
  const submitOnEnter = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!saveBtn.disabled) save();
  };
  amountInput.addEventListener('keydown', submitOnEnter);
  titleInput.addEventListener('keydown', submitOnEnter);

  const deleteBtn = editing
    ? h('button.btn.btn--danger.btn--block', { type: 'button', text: 'Delete expense' })
    : null;

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmAction({
        title: 'Delete expense?',
        message: `"${expense.title}" will be removed from ${group.name}. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        store.deleteExpense(group.id, expense.id);
      } catch (error) {
        toast(error?.message || 'That expense could not be deleted.', { type: 'error' });
        return;
      }
      onSaved?.();
      dialog.close('deleted');
    });
  }

  // --- assemble ------------------------------------------------------------

  const body = h('div.stack.stack--loose', null, [
    h('div.stack', null, [
      amountField,
      field('What was it for?', titleInput, { id: `${uid}-title` }),
      h('div.row', null, [
        h('div.field.spacer', { style: { minWidth: '0' } }, [
          h('label.field__label', { text: 'Category', for: `${uid}-cat` }),
          categorySelect,
        ]),
        h('div.field.spacer', { style: { minWidth: '0' } }, [
          h('label.field__label', { text: 'Date', for: `${uid}-date` }),
          dateInput,
        ]),
      ]),
      field('Notes', notesInput, { id: `${uid}-notes` }),
    ]),

    h('div.stack.stack--tight', null, [
      h('div.section-title', { text: 'Paid by' }),
      h('label.checkbox-row', null, [multiPayerToggle, h('span', { text: 'Multiple people paid' })]),
      payerHost,
    ]),

    h('div.stack.stack--tight', null, [
      h('div.section-title', { text: 'Split' }),
      modeSegmented,
      modeHint,
      splitRowsHost,
      splitRemaining,
    ]),

    deleteBtn,
  ]);

  categorySelect.id = `${uid}-cat`;
  dateInput.id = `${uid}-date`;

  const dialog = openSheet({
    title: editing ? 'Edit expense' : 'Add expense',
    body,
    footer: () => [
      h('button.btn', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
      saveBtn,
    ],
  });

  renderPayers();
  syncValueInputs();
  syncPayerInputs();
  update();

  return dialog;
}
