/**
 * The people in a group: who they are, what they have put in, and who can
 * still be taken out.
 *
 * Removal is the delicate part. Deleting someone who appears anywhere in the
 * ledger would quietly rewrite what everyone else owes, so the store decides
 * and this view only explains the answer.
 */
import { h, avatar, icon, ICONS } from '../../util/dom.js';
import { confirmAction, emptyState, promptText } from '../components.js';
import { formatMoney } from '../../money.js';
import { groupTotals } from '../../balance.js';

export default function membersView(ctx) {
  const { group, store, navigate, toast } = ctx;

  if (!group) return missingGroup(navigate);

  const currency = group.currency;
  const totals = groupTotals(group);

  const addPerson = async () => {
    const name = await promptText({
      title: 'Add a person',
      label: 'Name',
      placeholder: 'e.g. Priya',
      confirmLabel: 'Add',
    });
    if (!name) return;

    // Two people called "Arun" make every balance row ambiguous, and the
    // mistake is nearly always a double tap rather than a real namesake.
    const clash = group.members.some((m) => m.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      toast(`${name} is already in this group.`, { type: 'error' });
      return;
    }

    // The store throws if the group vanished (another tab deleting it), so a
    // failed add can never be reported as a success.
    try {
      store.addMember(group.id, name);
    } catch (error) {
      toast(error?.message || 'That person could not be added.', { type: 'error' });
      return;
    }
    toast(`${name} added.`, { type: 'success' });
  };

  const rename = async (member) => {
    const name = await promptText({
      title: 'Rename',
      label: 'Name',
      value: member.name,
    });
    if (!name || name === member.name) return;

    const clash = group.members.some(
      (m) => m.id !== member.id && m.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      toast(`${name} is already in this group.`, { type: 'error' });
      return;
    }

    store.renameMember(group.id, member.id, name);
  };

  const remove = async (member) => {
    const check = store.canRemoveMember(group.id, member.id);
    if (!check.ok) {
      toast(check.reason, { type: 'error' });
      return;
    }

    const ok = await confirmAction({
      title: `Remove ${member.name}?`,
      message: 'They are not part of any expense or payment, so nothing else changes.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;

    try {
      store.removeMember(group.id, member.id);
      toast(`${member.name} removed.`);
    } catch (error) {
      // The ledger can change between the check and the confirmation (another
      // tab, a recurring expense firing), and removeMember re-checks.
      toast(error?.message || 'That person could not be removed.', { type: 'error' });
    }
  };

  const content = group.members.length === 0
    ? emptyState({
        iconPath: ICONS.users,
        title: 'No one here yet',
        message: 'Add the people you are splitting with.',
        action: h('button.btn.btn--primary', { type: 'button', text: 'Add person', onclick: addPerson }),
      })
    : h('div.list', null, group.members.map((member) => memberRow(member, {
        currency,
        totals: totals.perMember[member.id],
        onRename: () => rename(member),
        onRemove: () => remove(member),
      })));

  return {
    title: 'People',
    subtitle: group.name,
    back: `/g/${group.id}`,
    tab: 'groups',
    content,
    fab: group.members.length === 0 ? null : h('button.fab', {
      type: 'button',
      onclick: addPerson,
    }, [icon(ICONS.plus), h('span', { text: 'Add person' })]),
  };
}

function missingGroup(navigate) {
  return {
    title: 'People',
    tab: 'groups',
    content: emptyState({
      iconPath: ICONS.users,
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

function memberRow(member, { currency, totals, onRename, onRemove }) {
  const paid = totals?.paid || 0;
  const share = totals?.share || 0;
  const subtitle = paid === 0 && share === 0
    ? 'No expenses yet'
    : `Paid ${formatMoney(paid, currency)} · share ${formatMoney(share, currency)}`;

  // The row is a static container because it holds two separate actions, and a
  // button cannot be nested inside another button. The name area is its own
  // ghost button so tapping it still opens the rename prompt.
  return h('div.list__item.list__item--static', null, [
    // The avatar is the colour swatch: it is filled with member.color, which the
    // store assigns from MEMBER_COLORS, so a second chip would only repeat it.
    avatar(member),
    h('button.btn.btn--ghost.spacer', {
      type: 'button',
      style: { justifyContent: 'flex-start', minWidth: 0, padding: '0', textAlign: 'left' },
      'aria-label': `Rename ${member.name}`,
      onclick: onRename,
    }, h('div.list__body', null, [
      h('div.list__title.truncate', { text: member.name }),
      h('div.list__sub.truncate', { text: subtitle }),
    ])),
    h('button.btn.btn--icon', {
      type: 'button',
      'aria-label': `Remove ${member.name}`,
      onclick: onRemove,
    }, icon(ICONS.trash, { size: 18 })),
  ]);
}
