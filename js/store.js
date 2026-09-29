/**
 * Application state and persistence.
 *
 * One object, one localStorage key, a subscribe/notify loop. Mutations go
 * through the action functions below so every change is validated, timestamped
 * and persisted the same way.
 *
 * Writes are debounced: typing in an expense form can fire many updates a
 * second, and serialising the whole store on each keystroke is wasteful.
 */
import { migrate, normaliseState, normaliseGroup, MEMBER_COLORS, SCHEMA_VERSION } from './schema.js';
import { generateDue } from './recurring.js';
import { newId } from './util/id.js';
import { todayISO } from './util/date.js';

const STORAGE_KEY = 'splitly.state.v1';
const WRITE_DELAY_MS = 250;

let state = normaliseState(null);
const listeners = new Set();
let writeTimer = null;

/**
 * Storage can fail: Safari private mode throws on write, and users can fill
 * the quota. We surface that once rather than letting every save throw.
 */
let storageWorks = true;
let storageWarning = null;

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    // Corrupt JSON: keep the bad copy aside instead of destroying it silently,
    // so the data can still be recovered by hand.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localStorage.setItem(`${STORAGE_KEY}.corrupt.${Date.now()}`, raw);
    } catch { /* nothing more we can do */ }
    storageWarning = 'Your saved data could not be read and has been set aside. Starting fresh.';
    return null;
  }
}

function writeStorage() {
  if (!storageWorks) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    storageWorks = false;
    storageWarning = error?.name === 'QuotaExceededError'
      ? 'Storage is full, so recent changes are not being saved. Export a backup and remove some old groups.'
      : 'This browser is blocking local storage, so changes will be lost when you close the tab. Private browsing usually causes this.';
    notify();
  }
}

function flush() {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  writeStorage();
}

function scheduleWrite() {
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeStorage();
  }, WRITE_DELAY_MS);
}

function notify() {
  for (const listener of listeners) listener(state);
}

/** Apply a change, persist it, and tell the UI. */
function commit(mutator, { immediate = false } = {}) {
  mutator(state);
  if (immediate) flush();
  else scheduleWrite();
  notify();
}

function touch(group) {
  group.updatedAt = new Date().toISOString();
}

// --- lifecycle -------------------------------------------------------------

export function init() {
  state = normaliseState(migrate(readStorage()));
  runRecurring();
  // Another tab of the same app changing data should not leave this one stale.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || event.newValue === null) return;
    try {
      state = normaliseState(migrate(JSON.parse(event.newValue)));
      notify();
    } catch { /* ignore a bad write from elsewhere */ }
  });
  // A debounced write could still be pending when the tab goes away.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState() {
  return state;
}

export function getGroup(groupId) {
  return state.groups[groupId] || null;
}

export function getStorageWarning() {
  return storageWarning;
}

export function clearStorageWarning() {
  storageWarning = null;
}

export { flush };

// --- settings --------------------------------------------------------------

export function updateSettings(patch) {
  commit((s) => { s.settings = { ...s.settings, ...patch }; }, { immediate: true });
}

export function setActiveGroup(groupId) {
  commit((s) => { s.activeGroupId = s.groups[groupId] ? groupId : null; });
}

// --- groups ----------------------------------------------------------------

export function createGroup({ name, type = 'other', currency, memberNames = [] }) {
  const id = newId();
  const now = new Date().toISOString();

  const members = memberNames
    .map((memberName, index) => ({
      id: newId(),
      name: String(memberName).trim(),
      color: MEMBER_COLORS[index % MEMBER_COLORS.length],
    }))
    .filter((m) => m.name);

  const group = {
    id,
    name: String(name || '').trim() || 'Untitled group',
    type,
    currency: currency || { code: 'INR', symbol: '₹' },
    members,
    expenses: [],
    settlements: [],
    recurring: [],
    createdAt: now,
    updatedAt: now,
  };

  commit((s) => {
    s.groups[id] = group;
    s.activeGroupId = id;
  }, { immediate: true });

  return id;
}

export function updateGroup(groupId, patch) {
  commit((s) => {
    const group = s.groups[groupId];
    if (!group) return;
    Object.assign(group, patch);
    touch(group);
  });
}

export function deleteGroup(groupId) {
  commit((s) => {
    delete s.groups[groupId];
    if (s.activeGroupId === groupId) s.activeGroupId = null;
  }, { immediate: true });
}

/** Adopt an imported group, giving it fresh ids so it can't clobber an existing one. */
export function importGroup(rawGroup, { replaceId = null } = {}) {
  const group = normaliseGroup(rawGroup);

  if (replaceId && state.groups[replaceId]) {
    group.id = replaceId;
  } else {
    // A share payload carries no group id, so an import always lands on a fresh
    // one and can never clobber an existing group. That makes the id useless for
    // spotting a re-import; the visible name is what would actually confuse
    // someone, so disambiguate on that.
    if (state.groups[group.id]) group.id = newId();

    const clash = Object.values(state.groups).some((g) => g.name === group.name);
    if (clash) group.name = `${group.name} (imported)`.slice(0, 80);
  }

  commit((s) => {
    s.groups[group.id] = group;
    s.activeGroupId = group.id;
  }, { immediate: true });

  return group.id;
}

/** Replace the entire store from a backup file. */
export function replaceState(rawState) {
  const next = normaliseState(migrate(rawState));
  if (Object.keys(next.groups).length === 0) {
    throw new Error('That backup contains no usable groups.');
  }
  commit((s) => {
    s.groups = next.groups;
    s.activeGroupId = next.activeGroupId;
    s.settings = next.settings;
    s.version = SCHEMA_VERSION;
  }, { immediate: true });
  return Object.keys(next.groups).length;
}

// --- members ---------------------------------------------------------------

export function addMember(groupId, name) {
  const id = newId();
  commit((s) => {
    const group = s.groups[groupId];
    if (!group) return;
    group.members.push({
      id,
      name: String(name).trim() || `Person ${group.members.length + 1}`,
      color: MEMBER_COLORS[group.members.length % MEMBER_COLORS.length],
    });
    touch(group);
  }, { immediate: true });
  return id;
}

export function renameMember(groupId, memberId, name) {
  commit((s) => {
    const member = s.groups[groupId]?.members.find((m) => m.id === memberId);
    if (!member) return;
    member.name = String(name).trim() || member.name;
    touch(s.groups[groupId]);
  });
}

/**
 * A member can only leave if they are not tangled up in the ledger; removing
 * someone who appears in an expense would silently change what everyone owes.
 */
export function canRemoveMember(groupId, memberId) {
  const group = state.groups[groupId];
  if (!group) return { ok: false, reason: 'Group not found.' };
  if (group.members.length <= 1) return { ok: false, reason: 'A group needs at least one person.' };

  const inExpense = group.expenses.some(
    (e) => e.payers.some((p) => p.memberId === memberId) || e.owedMinor[memberId] !== undefined,
  );
  if (inExpense) {
    return { ok: false, reason: 'This person appears in an expense. Delete or edit those expenses first.' };
  }

  const inSettlement = group.settlements.some(
    (s) => s.fromMemberId === memberId || s.toMemberId === memberId,
  );
  if (inSettlement) {
    return { ok: false, reason: 'This person appears in a payment. Delete those payments first.' };
  }

  const inTemplate = group.recurring.some(
    (t) => t.expense.payers.some((p) => p.memberId === memberId)
      || t.expense.owedMinor[memberId] !== undefined,
  );
  if (inTemplate) {
    return { ok: false, reason: 'This person is in a recurring expense. Remove it first.' };
  }

  return { ok: true, reason: null };
}

export function removeMember(groupId, memberId) {
  const check = canRemoveMember(groupId, memberId);
  if (!check.ok) throw new Error(check.reason);
  commit((s) => {
    const group = s.groups[groupId];
    group.members = group.members.filter((m) => m.id !== memberId);
    touch(group);
  }, { immediate: true });
}

// --- expenses --------------------------------------------------------------

export function addExpense(groupId, expense) {
  const id = newId();
  const now = new Date().toISOString();
  commit((s) => {
    const group = s.groups[groupId];
    if (!group) return;
    group.expenses.push({ ...expense, id, createdAt: now, updatedAt: now });
    touch(group);
  }, { immediate: true });
  return id;
}

export function updateExpense(groupId, expenseId, patch) {
  commit((s) => {
    const group = s.groups[groupId];
    const index = group?.expenses.findIndex((e) => e.id === expenseId);
    if (index === undefined || index < 0) return;
    group.expenses[index] = {
      ...group.expenses[index],
      ...patch,
      id: expenseId,
      updatedAt: new Date().toISOString(),
    };
    touch(group);
  }, { immediate: true });
}

export function deleteExpense(groupId, expenseId) {
  commit((s) => {
    const group = s.groups[groupId];
    if (!group) return;
    group.expenses = group.expenses.filter((e) => e.id !== expenseId);
    touch(group);
  }, { immediate: true });
}

// --- settlements -----------------------------------------------------------

export function addSettlement(groupId, settlement) {
  const id = newId();
  commit((s) => {
    const group = s.groups[groupId];
    if (!group) return;
    group.settlements.push({
      ...settlement,
      id,
      date: settlement.date || todayISO(),
      createdAt: new Date().toISOString(),
    });
    touch(group);
  }, { immediate: true });
  return id;
}

export function deleteSettlement(groupId, settlementId) {
  commit((s) => {
    const group = s.groups[groupId];
    if (!group) return;
    group.settlements = group.settlements.filter((x) => x.id !== settlementId);
    touch(group);
  }, { immediate: true });
}

// --- recurring -------------------------------------------------------------

export function addTemplate(groupId, template) {
  const id = newId();
  commit((s) => {
    const group = s.groups[groupId];
    if (!group) return;
    group.recurring.push({ ...template, id });
    touch(group);
  }, { immediate: true });
  return id;
}

export function updateTemplate(groupId, templateId, patch) {
  commit((s) => {
    const group = s.groups[groupId];
    const template = group?.recurring.find((t) => t.id === templateId);
    if (!template) return;
    Object.assign(template, patch, { id: templateId });
    touch(group);
  }, { immediate: true });
}

export function deleteTemplate(groupId, templateId) {
  commit((s) => {
    const group = s.groups[groupId];
    if (!group) return;
    group.recurring = group.recurring.filter((t) => t.id !== templateId);
    touch(group);
  }, { immediate: true });
}

/**
 * Fire any recurring expenses that came due while the app was closed.
 * Each group's expenses and templates are updated together, so an interrupted
 * run can never leave a template that has generated but not advanced.
 */
export function runRecurring(today = todayISO()) {
  const generated = [];

  commit((s) => {
    for (const group of Object.values(s.groups)) {
      if (group.recurring.length === 0) continue;
      const { created, templates } = generateDue(group, today);
      if (created.length === 0) continue;
      group.expenses.push(...created);
      group.recurring = templates;
      touch(group);
      generated.push({ groupId: group.id, groupName: group.name, count: created.length });
    }
  }, { immediate: true });

  return generated;
}
