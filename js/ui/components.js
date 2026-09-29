/**
 * Shared UI pieces: sheets (native <dialog>), toasts and confirmations.
 */
import { h, append, icon, ICONS } from '../util/dom.js';

/**
 * A modal sheet built on <dialog>, so the browser handles the top layer,
 * focus trapping, inertness of the page behind, and Escape to close.
 *
 * `closedby="any"` gives click-outside dismissal natively. Browsers without
 * it fall back to a manual backdrop click handler below.
 */
export function openSheet({ title, body, footer, onClose, size }) {
  const dialog = h('dialog.sheet');
  if (size) dialog.style.maxWidth = size;

  // Newer browsers honour this; older ones ignore the unknown attribute.
  dialog.setAttribute('closedby', 'any');

  const heading = h('h2', { text: title });
  const closeBtn = h('button.btn.btn--icon', {
    type: 'button',
    'aria-label': 'Close',
    onclick: () => dialog.close('dismiss'),
  }, icon(ICONS.close));

  const head = h('div.sheet__head', null, [heading, h('span.spacer'), closeBtn]);
  const bodyEl = h('div.sheet__body');
  append(bodyEl, typeof body === 'function' ? body(dialog) : body);

  append(dialog, [head, bodyEl]);
  if (footer) {
    const footEl = h('div.sheet__foot');
    append(footEl, typeof footer === 'function' ? footer(dialog) : footer);
    append(dialog, footEl);
  }

  // Fallback light dismiss for browsers without `closedby`: a click landing on
  // the dialog element itself is a click on the backdrop, since the content
  // fills the box.
  if (!('closedBy' in dialog)) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close('dismiss');
    });
  }

  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.(dialog.returnValue);
  });

  document.body.appendChild(dialog);
  dialog.showModal();

  // Focus the first meaningful control rather than the close button.
  const firstField = dialog.querySelector('input:not([type=hidden]), textarea, select');
  if (firstField && window.matchMedia('(min-width: 640px)').matches) {
    firstField.focus();
    if (firstField.select) firstField.select();
  }

  return dialog;
}

/** Yes/no confirmation. Resolves to true only on an explicit confirm. */
export function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const dialog = openSheet({
      title,
      body: h('p', { text: message }),
      footer: () => [
        h('button.btn', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
        h(`button.btn.${danger ? 'btn--danger' : 'btn--primary'}`, {
          type: 'button',
          text: confirmLabel,
          onclick: () => { confirmed = true; dialog.close('confirm'); },
        }),
      ],
      onClose: () => resolve(confirmed),
    });
  });
}

/** A single-field prompt, used for renames and quick adds. */
export function promptText({ title, label, value = '', placeholder = '', confirmLabel = 'Save', maxLength = 80 }) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input.input', { type: 'text', value, placeholder, maxLength, autocomplete: 'off' });

    const submit = () => {
      const text = input.value.trim();
      if (!text) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      result = text;
      dialog.close('ok');
    };

    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    });

    const dialog = openSheet({
      title,
      body: h('div.field', null, [h('label.field__label', { text: label }), input]),
      footer: () => [
        h('button.btn', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
        h('button.btn.btn--primary', { type: 'button', text: confirmLabel, onclick: submit }),
      ],
      onClose: () => resolve(result),
    });

    input.focus();
    input.select();
  });
}

// --- toasts ----------------------------------------------------------------

let toastHost = null;

function ensureToastHost() {
  if (!toastHost) {
    toastHost = h('div.toast-host', { role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

export function toast(message, { type = 'info', duration = 3600, action } = {}) {
  const host = ensureToastHost();
  const el = h(`div.toast${type === 'error' ? '.toast--error' : type === 'success' ? '.toast--success' : ''}`);
  append(el, h('span', { class: 'spacer', text: message }));

  if (action) {
    append(el, h('button.toast__action', {
      type: 'button',
      text: action.label,
      onclick: () => { action.onClick(); dismiss(); },
    }));
  }

  const dismiss = () => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 180);
  };

  el.style.transition = 'opacity 0.18s, transform 0.18s';
  host.appendChild(el);
  // Errors stay long enough to read; an action needs time to be clicked.
  setTimeout(dismiss, type === 'error' ? Math.max(duration, 5200) : duration);
  return dismiss;
}

// --- small building blocks -------------------------------------------------

export function field(label, control, { hint, error, id } = {}) {
  if (id) control.id = id;
  const parts = [h('label.field__label', { text: label, for: id || null })];
  parts.push(control);
  if (hint) parts.push(h('span.field__hint', { text: hint }));
  if (error) parts.push(h('span.field__error', { role: 'alert', text: error }));
  return h('div.field', null, parts);
}

export function segmented(options, activeId, onPick, { label } = {}) {
  const wrap = h('div.segmented', { role: 'group', 'aria-label': label || 'Options' });
  for (const option of options) {
    append(wrap, h('button.segmented__option', {
      type: 'button',
      'aria-pressed': String(option.id === activeId),
      text: option.label,
      onclick: () => onPick(option.id),
    }));
  }
  return wrap;
}

export function emptyState({ iconPath, title, message, action }) {
  return h('div.empty', null, [
    iconPath ? h('div.empty__icon', null, icon(iconPath, { size: 26 })) : null,
    h('h2', { text: title }),
    message ? h('p.small', { text: message }) : null,
    action || null,
  ]);
}

export function listItem({ leading, title, subtitle, endTop, endBottom, endClass, onClick, chevron = false }) {
  const body = h('div.list__body', null, [
    h('div.list__title.truncate', { text: title }),
    subtitle ? h('div.list__sub.truncate', { text: subtitle }) : null,
  ]);

  const end = (endTop || endBottom)
    ? h('div.list__end', null, [
        endTop ? h(`div.num${endClass ? `.${endClass}` : ''}`, { text: endTop }) : null,
        endBottom ? h('div.list__sub', { text: endBottom }) : null,
      ])
    : null;

  return h(`${onClick ? 'button' : 'div'}.list__item${onClick ? '' : '.list__item--static'}`, {
    type: onClick ? 'button' : null,
    onclick: onClick || null,
  }, [leading || null, body, end, chevron ? icon(ICONS.chevron, { size: 16 }) : null]);
}
