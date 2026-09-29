/**
 * Recurring expense templates.
 *
 * There is no server and no background timer, so generation happens lazily:
 * every time the app opens we look for templates whose next occurrence is due
 * and create the missed expenses. Someone who hasn't opened the app in three
 * months gets all three months generated at once.
 */
import { addDays, addMonths, addYears, compareISO, todayISO } from './util/date.js';
import { newId } from './util/id.js';

export const FREQUENCIES = [
  { id: 'daily', label: 'Daily', unit: 'day' },
  { id: 'weekly', label: 'Weekly', unit: 'week' },
  { id: 'monthly', label: 'Monthly', unit: 'month' },
  { id: 'yearly', label: 'Yearly', unit: 'year' },
];

/** Cap on catch-up generation, so a template left running for years can't
 *  create thousands of expenses in one go and lock up the page. */
export const MAX_CATCHUP = 60;

export function advance(iso, frequency, interval = 1) {
  const step = Math.max(1, Math.round(interval));
  switch (frequency) {
    case 'daily': return addDays(iso, step);
    case 'weekly': return addDays(iso, 7 * step);
    case 'monthly': return addMonths(iso, step);
    case 'yearly': return addYears(iso, step);
    default: return addMonths(iso, step);
  }
}

export function describeFrequency(frequency, interval = 1) {
  const f = FREQUENCIES.find((x) => x.id === frequency);
  if (!f) return 'Repeats';
  if (interval === 1) return f.label;
  return `Every ${interval} ${f.unit}s`;
}

/**
 * Work out which occurrences of a template are due on or before `today`.
 * Pure — returns dates only, so it is trivially testable and the caller
 * decides whether to actually write anything.
 */
export function dueDates(template, today = todayISO()) {
  if (!template.active) return [];

  const dates = [];
  let cursor = template.nextDueDate || template.startDate;
  if (!cursor) return [];

  while (compareISO(cursor, today) <= 0 && dates.length < MAX_CATCHUP) {
    if (template.endDate && compareISO(cursor, template.endDate) > 0) break;
    dates.push(cursor);
    cursor = advance(cursor, template.frequency, template.interval);
  }

  return dates;
}

/** The date a template will next fire, after any catch-up. */
export function nextOccurrence(template, today = todayISO()) {
  let cursor = template.nextDueDate || template.startDate;
  if (!cursor) return null;
  let guard = 0;
  while (compareISO(cursor, today) <= 0 && guard < MAX_CATCHUP + 1) {
    cursor = advance(cursor, template.frequency, template.interval);
    guard += 1;
  }
  if (template.endDate && compareISO(cursor, template.endDate) > 0) return null;
  return cursor;
}

/**
 * Expand every active template in a group into concrete expenses.
 * Returns the new expenses plus the updated templates; the store applies both
 * in a single write so a half-finished run can't leave duplicates behind.
 */
export function generateDue(group, today = todayISO()) {
  const created = [];
  const templates = group.recurring.map((template) => {
    const dates = dueDates(template, today);
    if (dates.length === 0) return template;

    for (const date of dates) {
      created.push({
        ...structuredClone(template.expense),
        id: newId(),
        date,
        recurringId: template.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const last = dates[dates.length - 1];
    const next = advance(last, template.frequency, template.interval);
    const finished = template.endDate && compareISO(next, template.endDate) > 0;

    return {
      ...template,
      nextDueDate: next,
      lastGeneratedDate: last,
      active: finished ? false : template.active,
    };
  });

  return { created, templates };
}

/** Templates firing within the next `days` days — drives the "coming up" banner. */
export function upcoming(group, days = 7, today = todayISO()) {
  const horizon = addDays(today, days);
  return group.recurring
    .filter((t) => t.active)
    .map((t) => ({ template: t, date: nextOccurrence(t, today) }))
    .filter((x) => x.date && compareISO(x.date, horizon) <= 0)
    .sort((a, b) => compareISO(a.date, b.date));
}
