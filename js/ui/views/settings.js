/**
 * Settings: appearance, and everything to do with getting data in and out.
 *
 * This screen is the only safety net the app has. There is no server copy, so
 * the backup actions here are load-bearing and are worded to say so plainly
 * rather than hiding behind "your privacy matters to us".
 */
import { h, icon, ICONS } from '../../util/dom.js';
import { openSheet, confirmAction, field, segmented } from '../components.js';
import { todayISO } from '../../util/date.js';
import { buildBackup, readBackup } from '../../export/json.js';
import { downloadJson, pickFile } from '../../export/download.js';
import { decodeGroup, readShareCodeFromHash } from '../../share.js';

const THEMES = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

function card(title, children) {
  return h('div.card', null, [
    h('div.stack', null, [h('h3', { text: title }), ...children]),
  ]);
}

function actionRow(label, description, control) {
  return h('div.stack.stack--tight', null, [
    h('div', null, [
      h('div', { text: label, style: { fontWeight: '550' } }),
      description ? h('div.small.muted', { text: description }) : null,
    ]),
    control,
  ]);
}

/**
 * A share link and a bare share code both end up here. Anything with a '#' is
 * treated as a URL and the code pulled out of the fragment; everything else is
 * assumed to already be the code, and decodeGroup reports it if it is not.
 */
function extractShareCode(input) {
  const text = String(input || '').trim();
  const hashAt = text.indexOf('#');
  if (hashAt === -1) return text;
  return readShareCodeFromHash(text.slice(hashAt)) || text;
}

function openImportSheet(ctx) {
  const area = h('textarea.textarea', {
    placeholder: 'Paste a share link or code here',
    rows: 4,
    autocomplete: 'off',
  });
  const error = h('span.field__error', { role: 'alert', hidden: true });

  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
  };

  const submit = async (importBtn) => {
    const code = extractShareCode(area.value);
    if (!code) {
      fail('Paste a link or code first.');
      area.focus();
      return;
    }

    importBtn.disabled = true;
    try {
      const group = await decodeGroup(code);
      // Decoding is async and only this button was disabled - Cancel, Escape
      // and a backdrop click all stay live. If the sheet went away while we
      // were decoding, the user cancelled: don't import behind their back and
      // don't yank them to a group they chose not to add.
      if (!dialog.open) return;
      const id = ctx.store.importGroup(group);
      dialog.close('imported');
      ctx.navigate(`/g/${id}`);
    } catch (err) {
      importBtn.disabled = false;
      fail(err?.message || 'That link could not be read.');
    }
  };

  const importBtn = h('button.btn.btn--primary', {
    type: 'button',
    text: 'Import',
    onclick: () => submit(importBtn),
  });

  area.addEventListener('input', () => { error.hidden = true; });

  const dialog = openSheet({
    title: 'Import a group',
    body: [
      h('div.stack', null, [
        h('p.small.muted', { text: 'A share link carries the whole group inside it. Importing makes an independent copy here — it will not stay in sync with the sender.' }),
        h('div.field', null, [h('span.field__label', { text: 'Link or code' }), area, error]),
      ]),
    ],
    footer: () => [
      h('button.btn', { type: 'button', text: 'Cancel', onclick: () => dialog.close('cancel') }),
      importBtn,
    ],
  });
}

async function restoreFromBackup(ctx) {
  try {
    const file = await pickFile('application/json,.json');
    if (!file) return;

    const { scope, state, groups } = readBackup(file.text);

    // A single-group file is almost always "put this group back", not "throw
    // away everything else". Adding it is both the likelier intent and the
    // recoverable choice: an unwanted extra group can be deleted, whereas
    // groups destroyed by a needless replace are gone.
    if (scope === 'group' && groups.length === 1) {
      const name = groups[0]?.name || 'that group';
      const ok = await confirmAction({
        title: 'Add this group?',
        message: `"${file.name}" holds one group, ${name}. It will be added alongside `
          + 'what you already have. Nothing currently in this browser is removed.',
        confirmLabel: 'Add group',
      });
      if (!ok) return;

      ctx.store.importGroup(groups[0]);
      ctx.toast(`${name} added.`, { type: 'success' });
      return;
    }

    const incoming = groups.length;
    const existing = Object.keys(ctx.state.groups).length;
    const ok = await confirmAction({
      title: 'Replace everything?',
      message: `Restoring "${file.name}" replaces all data currently in this browser with the ${incoming} `
        + `${incoming === 1 ? 'group' : 'groups'} in that file. `
        + (existing > 0
          ? `Your ${existing} current ${existing === 1 ? 'group' : 'groups'} will be lost.`
          : 'There is nothing here to lose.'),
      confirmLabel: 'Replace my data',
      danger: true,
    });
    if (!ok) return;

    const count = ctx.store.replaceState(state);
    ctx.toast(`Restored ${count} ${count === 1 ? 'group' : 'groups'}.`, { type: 'success' });
  } catch (error) {
    ctx.toast(error?.message || 'That backup could not be restored.', { type: 'error' });
  }
}

async function deleteEverything(ctx) {
  const ids = Object.keys(ctx.state.groups);
  if (ids.length === 0) {
    ctx.toast('There is nothing to delete.');
    return;
  }

  const ok = await confirmAction({
    title: 'Delete all data?',
    message: `This deletes all ${ids.length} ${ids.length === 1 ? 'group' : 'groups'} and every expense in them, `
      + 'from this browser. There is no server copy and no undo. Export a backup first if you might want any of it back.',
    confirmLabel: 'Delete everything',
    danger: true,
  });
  if (!ok) return;

  // Snapshotted above, because each delete mutates the live state object.
  for (const id of ids) ctx.store.deleteGroup(id);
  ctx.toast('All data deleted.', { type: 'success' });
}

export default function settingsView(ctx) {
  const { settings, groups } = ctx.state;
  const groupCount = Object.keys(groups).length;
  const expenseCount = Object.values(groups).reduce((total, g) => total + g.expenses.length, 0);

  // --- appearance
  const themeCard = card('Appearance', [
    field('Theme', segmented(
      THEMES,
      settings.theme,
      (theme) => ctx.store.updateSettings({ theme }),
      { label: 'Theme' },
    )),
  ]);

  // --- your name
  const nameInput = h('input.input', {
    type: 'text',
    value: settings.displayName || '',
    placeholder: 'e.g. Arun',
    maxLength: 80,
    autocomplete: 'name',
    // 'change' fires on blur, so this saves once the edit is finished rather
    // than re-rendering the whole view on every keystroke.
    onchange: (event) => ctx.store.updateSettings({ displayName: event.target.value.trim() }),
  });

  const nameCard = card('Your name', [
    field('Name', nameInput, {
      id: 'settings-display-name',
      hint: 'Only used to make the app feel less anonymous. It is never sent anywhere.',
    }),
  ]);

  // --- data
  const dataCard = card('Data', [
    h('p.small.muted', {
      text: groupCount === 0
        ? 'Nothing saved yet.'
        : `${groupCount} ${groupCount === 1 ? 'group' : 'groups'}, ${expenseCount} ${expenseCount === 1 ? 'expense' : 'expenses'} in this browser.`,
    }),

    actionRow('Export everything', 'One JSON file with every group, ready to restore on another device.',
      h('div.row.row--wrap', null, [
        h('button.btn.btn--primary.btn--sm', {
          type: 'button',
          onclick: () => {
            try {
              downloadJson(`splitly-backup-${todayISO()}.json`, buildBackup(ctx.state));
              ctx.toast('Backup downloaded', { type: 'success' });
            } catch (error) {
              ctx.toast(error?.message || 'That download failed.', { type: 'error' });
            }
          },
        }, [icon(ICONS.download, { size: 16 }), h('span', { text: 'Export everything' })]),
      ])),

    actionRow('Restore from backup', 'Reads a Splitly backup file and replaces everything currently here.',
      h('div.row.row--wrap', null, [
        h('button.btn.btn--sm', { type: 'button', text: 'Choose a file…', onclick: () => restoreFromBackup(ctx) }),
      ])),

    actionRow('Import a group', 'Add a single group from a share link or code someone sent you.',
      h('div.row.row--wrap', null, [
        h('button.btn.btn--sm', { type: 'button', text: 'Paste a link or code', onclick: () => openImportSheet(ctx) }),
      ])),

    actionRow('Delete all data', 'Removes every group and expense from this browser. This cannot be undone.',
      h('div.row.row--wrap', null, [
        h('button.btn.btn--danger.btn--sm', {
          type: 'button',
          onclick: () => deleteEverything(ctx),
        }, [icon(ICONS.trash, { size: 16 }), h('span', { text: 'Delete all data' })]),
      ])),
  ]);

  // --- where your data lives
  const storageCard = card('Where your data lives', [
    h('p.small.muted', {
      text: 'Everything you add is stored in this browser, on this device. There is no account and no server, '
        + 'so nobody else can see it — but clearing your site data, or using a private window, erases it just as '
        + 'permanently. Export a backup every so often, especially before switching phones.',
    }),
  ]);

  const aboutCard = card('About', [
    h('p.small.muted', { text: 'Splitly — a local-first expense splitter for the people you travel, live and eat with.' }),
  ]);

  return {
    title: 'Settings',
    tab: 'settings',
    content: h('div.stack.stack--loose', null, [themeCard, nameCard, dataCard, storageCard, aboutCard]),
  };
}
