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
    exportedAt: new Date().toISOString(),
    state: {
      version: SCHEMA_VERSION,
      activeGroupId: state.activeGroupId,
      settings: state.settings,
      groups: state.groups,
    },
  };
}

export function buildGroupBackup(group) {
  return {
    kind: BACKUP_KIND,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    state: { version: SCHEMA_VERSION, activeGroupId: group.id, settings: {}, groups: { [group.id]: group } },
  };
}

/**
 * Accepts either a full backup envelope or a bare state object, so a file
 * hand-edited down to just the groups still restores.
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new Error('That file is empty.');

  if (data.kind === BACKUP_KIND && data.state) return data.state;
  if (data.groups && typeof data.groups === 'object') return data;
  if (data.members && data.expenses) return { groups: { imported: data } };

  throw new Error('That file does not look like a backup from this app.');
}
