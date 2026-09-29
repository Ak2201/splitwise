/**
 * Full backup and restore. The only export that can actually bring the app
 * back from an empty localStorage, so it keeps every field rather than the
 * trimmed shape used for share links.
 */
import { SCHEMA_VERSION } from '../schema.js';

export const BACKUP_KIND = 'splitly.backup';

export function buildBackup(state) {
  return {
    kind: BACKUP_KIND,
    version: SCHEMA_VERSION,
    scope: 'all',
    exportedAt: new Date().toISOString(),
    state: {
      version: SCHEMA_VERSION,
      activeGroupId: state.activeGroupId,
      settings: state.settings,
      groups: state.groups,
    },
  };
}

/**
 * A single group, in the same envelope but marked as such.
 *
 * The `scope` matters: a one-group file and a whole-library file used to be
 * indistinguishable, so restoring "backup of this group" wiped every other
 * group and reset your settings. Marked, the restore flow can add the group
 * instead of replacing everything.
 */
export function buildGroupBackup(group) {
  return {
    kind: BACKUP_KIND,
    version: SCHEMA_VERSION,
    scope: 'group',
    exportedAt: new Date().toISOString(),
    state: { version: SCHEMA_VERSION, activeGroupId: group.id, settings: {}, groups: { [group.id]: group } },
  };
}

/**
 * Read a backup file into `{ scope, state }`.
 *
 * `scope` is 'group' for a single-group export and 'all' for a whole-library
 * one, so the caller can add rather than replace. Files written before the
 * marker existed, and hand-edited ones, fall back to counting groups: a file
 * holding exactly one group is treated as a group export, which is the safe
 * reading - the worst case is offering to add a group the user meant to
 * restore wholesale, rather than deleting groups they meant to keep.
 *
 * Accepts a full envelope or a bare state object, so a file trimmed down to
 * just the groups still restores.
 */
export function readBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new Error('That file is empty.');

  let state = null;
  let declared = null;

  if (data.kind === BACKUP_KIND && data.state) {
    state = data.state;
    declared = data.scope === 'group' || data.scope === 'all' ? data.scope : null;
  } else if (data.groups && typeof data.groups === 'object') {
    state = data;
  } else if (data.members && data.expenses) {
    // A bare group object, not an envelope at all.
    state = { groups: { imported: data } };
    declared = 'group';
  } else {
    throw new Error('That file does not look like a backup from this app.');
  }

  const groups = Object.values(state.groups || {});
  const scope = declared || (groups.length === 1 ? 'group' : 'all');
  return { scope, state, groups };
}

/** Back-compat: the state alone, for callers that only ever replace. */
export function parseBackup(text) {
  return readBackup(text).state;
}
