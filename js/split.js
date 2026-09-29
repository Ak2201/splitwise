/**
 * Resolves "how much does each participant owe" for the five split modes.
 *
 * Every mode returns amounts that sum to exactly the expense total. Modes that
 * need rounding go through allocate() (largest-remainder), so no unit is ever
 * lost or invented.
 */
import { allocate, sum } from './money.js';

export const SPLIT_MODES = [
  { id: 'equal', label: 'Equally', hint: 'Split the total evenly between everyone selected' },
  { id: 'exact', label: 'Exact amounts', hint: 'Type what each person owes' },
  { id: 'percent', label: 'Percentages', hint: 'Assign a percentage to each person' },
  { id: 'shares', label: 'Shares', hint: 'Give people a number of shares, e.g. 2 for a couple' },
  { id: 'adjustment', label: 'Adjustment', hint: 'Split evenly, then add an extra amount for some people' },
];

export const PERCENT_SCALE = 100; // percentages held as hundredths: 33.33% -> 3333

/**
 * @param {number} totalMinor  expense total in minor units (> 0)
 * @param {string} mode        one of SPLIT_MODES ids
 * @param {Array<{memberId: string, value: number}>} participants
 * @returns {{owed: Object<string, number>, valid: boolean, error: string|null, remainingMinor: number}}
 *
 * `remainingMinor` is what's still unallocated — the UI shows it live as
 * "₹X left" so the user can see why a split doesn't balance yet.
 */
export function resolveSplit(totalMinor, mode, participants) {
  const ids = participants.map((p) => p.memberId);
  const empty = { owed: {}, valid: false, error: null, remainingMinor: totalMinor };

  if (participants.length === 0) {
    return { ...empty, error: 'Select at least one person to split between.' };
  }

  const pack = (amounts, error = null, remaining = 0) => {
    const owed = {};
    ids.forEach((id, i) => { owed[id] = amounts[i]; });
    return { owed, valid: !error, error, remainingMinor: remaining };
  };

  switch (mode) {
    case 'equal': {
      return pack(allocate(totalMinor, new Array(participants.length).fill(1)));
    }

    case 'exact': {
      const amounts = participants.map((p) => Math.round(p.value || 0));
      const allocated = sum(amounts);
      const remaining = totalMinor - allocated;
      if (remaining !== 0) {
        return pack(amounts, 'The amounts entered do not add up to the total.', remaining);
      }
      return pack(amounts);
    }

    case 'percent': {
      const pcts = participants.map((p) => Math.round(p.value || 0));
      const totalPct = sum(pcts);
      if (totalPct !== 100 * PERCENT_SCALE) {
        return pack(
          allocate(totalMinor, pcts.map((v) => Math.max(0, v))),
          'Percentages must add up to 100%.',
          Math.round(totalMinor * (100 * PERCENT_SCALE - totalPct) / (100 * PERCENT_SCALE)),
        );
      }
      // Weights are the percentages themselves; allocate handles the rounding.
      return pack(allocate(totalMinor, pcts));
    }

    case 'shares': {
      const shares = participants.map((p) => Math.max(0, Math.round(p.value || 0)));
      if (sum(shares) <= 0) {
        return { ...empty, error: 'Give at least one person a share.' };
      }
      return pack(allocate(totalMinor, shares));
    }

    case 'adjustment': {
      // Each person owes an even share of what's left after their own extra.
      const adjustments = participants.map((p) => Math.round(p.value || 0));
      const adjTotal = sum(adjustments);
      const base = totalMinor - adjTotal;
      if (base < 0) {
        return pack(
          adjustments,
          'The adjustments add up to more than the total.',
          base,
        );
      }
      const evenParts = allocate(base, new Array(participants.length).fill(1));
      return pack(evenParts.map((part, i) => part + adjustments[i]));
    }

    default:
      return { ...empty, error: `Unknown split mode "${mode}".` };
  }
}

/**
 * Seed sensible participant values when the user switches split mode, so the
 * form starts in a valid state instead of showing an error immediately.
 */
export function seedParticipants(totalMinor, mode, memberIds, previous = {}) {
  const n = memberIds.length;
  if (n === 0) return [];

  switch (mode) {
    case 'exact': {
      const parts = allocate(totalMinor, new Array(n).fill(1));
      return memberIds.map((memberId, i) => ({ memberId, value: parts[i] }));
    }
    case 'percent': {
      const parts = allocate(100 * PERCENT_SCALE, new Array(n).fill(1));
      return memberIds.map((memberId, i) => ({ memberId, value: parts[i] }));
    }
    case 'shares':
      return memberIds.map((memberId) => ({ memberId, value: previous[memberId] ?? 1 }));
    case 'adjustment':
      return memberIds.map((memberId) => ({ memberId, value: 0 }));
    case 'equal':
    default:
      return memberIds.map((memberId) => ({ memberId, value: 0 }));
  }
}

/** Normalise the payer list; a single payer covering the whole total is the default. */
export function resolvePayers(totalMinor, payers) {
  const paid = sum(payers.map((p) => Math.round(p.amountMinor || 0)));
  return {
    valid: paid === totalMinor,
    remainingMinor: totalMinor - paid,
    error: paid === totalMinor ? null : 'What the payers put in does not add up to the total.',
  };
}
