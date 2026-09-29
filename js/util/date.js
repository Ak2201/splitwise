/**
 * Calendar-date helpers working on 'YYYY-MM-DD' strings.
 *
 * Deliberately not Temporal: Temporal.PlainDate would be the natural fit, but
 * it ships in no Safari version and this app is mobile-first. Rather than pull
 * a polyfill into a zero-dependency project, these few functions reproduce
 * Temporal's `constrain` overflow semantics exactly:
 *   Jan 31 + 1 month -> Feb 28 (or Feb 29 in a leap year), not Mar 3.
 *
 * Plain strings also sidestep the timezone bugs you get from using `Date` for
 * calendar dates, where `new Date('2026-01-31')` is UTC midnight and can render
 * as the 30th for anyone west of Greenwich.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function todayISO() {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseISO(iso) {
  const match = ISO.exec(String(iso || ''));
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isValidISO(iso) {
  return parseISO(iso) !== null;
}

export function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Add whole months, clamping the day to the end of the target month. */
export function addMonths(iso, count) {
  const date = parseISO(iso);
  if (!date) return iso;
  const shifted = date.y * 12 + (date.m - 1) + count;
  const y = Math.floor(shifted / 12);
  const m = (shifted % 12 + 12) % 12 + 1;
  return toISO(y, m, Math.min(date.d, daysInMonth(y, m)));
}

export function addYears(iso, count) {
  const date = parseISO(iso);
  if (!date) return iso;
  const y = date.y + count;
  return toISO(y, date.m, Math.min(date.d, daysInMonth(y, date.m)));
}

export function addDays(iso, count) {
  const date = parseISO(iso);
  if (!date) return iso;
  // Safe here: we build and read the date in UTC consistently.
  const ms = Date.UTC(date.y, date.m - 1, date.d) + count * 86400000;
  const next = new Date(ms);
  return toISO(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** -1, 0 or 1 — string compare works because the format is fixed-width. */
export function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysBetween(a, b) {
  const da = parseISO(a);
  const db = parseISO(b);
  if (!da || !db) return 0;
  return Math.round((Date.UTC(db.y, db.m - 1, db.d) - Date.UTC(da.y, da.m - 1, da.d)) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Mar 2026", dropping the year when it's the current one. */
export function formatDate(iso) {
  const date = parseISO(iso);
  if (!date) return '';
  const thisYear = Number(todayISO().slice(0, 4));
  const base = `${date.d} ${MONTHS[date.m - 1]}`;
  return date.y === thisYear ? base : `${base} ${date.y}`;
}

/** Month heading used to group the expense list. */
export function monthLabel(iso) {
  const date = parseISO(iso);
  if (!date) return '';
  const thisYear = Number(todayISO().slice(0, 4));
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][date.m - 1];
  return date.y === thisYear ? full : `${full} ${date.y}`;
}

/** "Today" / "Yesterday" / "in 3 days" / "5 days ago" */
export function relativeDay(iso, from = todayISO()) {
  const diff = daysBetween(from, iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 0) return `in ${diff} days`;
  return `${-diff} days ago`;
}
