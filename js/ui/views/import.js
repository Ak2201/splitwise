/**
 * Where a share link lands.
 *
 * Nothing is written to the store until the person says so: an opened link
 * shows a preview first, because a link can arrive from anyone and silently
 * adding a stranger's group to someone's list would be rude at best.
 */
import { h, append, clear, icon, ICONS } from '../../util/dom.js';
import { formatMoney } from '../../money.js';
import { groupTotals } from '../../balance.js';
import { decodeGroup } from '../../share.js';

// A very large group would otherwise print a hundred names into the preview.
const NAMES_SHOWN = 8;

function memberSummary(members) {
  const shown = members.slice(0, NAMES_SHOWN).map((m) => m.name).join(', ');
  const hidden = members.length - NAMES_SHOWN;
  return hidden > 0 ? `${shown} and ${hidden} more` : shown;
}

function previewCard(ctx, group) {
  const totals = groupTotals(group);

  const add = () => {
    try {
      const id = ctx.store.importGroup(group);
      // replace: the import URL carries a payload nobody wants in their history.
      ctx.navigate(`/g/${id}`, { replace: true });
    } catch (error) {
      ctx.toast(error?.message || 'That group could not be added.', { type: 'error' });
    }
  };

  return h('div.stack', null, [
    h('div.card', null, [
      h('div.stack.stack--tight', null, [
        h('div.small.faint', { text: 'Shared group' }),
        h('h2', { text: group.name }),
        h('p.small.muted', { text: memberSummary(group.members) }),
        h('div.summary', null, [
          h('div.summary__cell', null, [
            h('div.summary__label', { text: 'Expenses' }),
            h('div.summary__value', { text: String(totals.expenseCount) }),
          ]),
          h('div.summary__cell', null, [
            h('div.summary__label', { text: 'Total' }),
            h('div.summary__value', { text: formatMoney(totals.totalSpent, group.currency) }),
          ]),
          h('div.summary__cell', null, [
            h('div.summary__label', { text: 'People' }),
            h('div.summary__value', { text: String(group.members.length) }),
          ]),
        ]),
      ]),
    ]),

    h('div.row.row--wrap', null, [
      h('button.btn.btn--primary', { type: 'button', onclick: add },
        [icon(ICONS.download, { size: 18 }), h('span', { text: 'Add to my groups' })]),
      h('button.btn', { type: 'button', text: 'Cancel', onclick: () => ctx.navigate('/', { back: true }) }),
    ]),

    h('p.small.faint', { text: 'This makes an independent copy in this browser. It will not stay in sync with whoever sent it, and they will not see anything you change.' }),
  ]);
}

function failureCard(ctx, message) {
  return h('div.stack', null, [
    h('div.banner.banner--warn', { text: message }),
    h('p.small.muted', { text: 'Share links are long and are easily cut short by a messenger. Ask for it again, or for a JSON backup file instead.' }),
    h('div.row', null, [
      h('button.btn.btn--primary', { type: 'button', text: 'Go to my groups', onclick: () => ctx.navigate('/', { back: true }) }),
    ]),
  ]);
}

export default function importView(ctx) {
  const container = h('div.stack', null, h('div.card', null, h('p.muted', { text: 'Reading share link…' })));

  // Decoding is async (the payload is compressed) but a view has to return
  // synchronously, so the container is handed back now and filled in later.
  // If the person navigates away first, this writes into a detached node and
  // is simply dropped — there is nothing to clean up.
  (async () => {
    try {
      const group = await decodeGroup(ctx.params.code || '');
      clear(container);
      append(container, previewCard(ctx, group));
    } catch (error) {
      clear(container);
      append(container, failureCard(ctx, error?.message || 'That share link could not be read.'));
    }
  })();

  return {
    title: 'Add shared group',
    tab: 'groups',
    content: container,
  };
}
