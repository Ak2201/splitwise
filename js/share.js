/**
 * Turning a group into a link, and back.
 *
 * The payload lives in the URL *fragment* (after the #), which browsers never
 * send to the server. So even though the app is hosted publicly, sharing a
 * group does not upload it anywhere - the data travels only inside the link
 * text, through whatever messenger the two people are already using.
 *
 * The trade-off is size: URLs have practical limits, so the payload is
 * compressed and the caller is told to fall back to a JSON file when a group
 * has grown too big to fit.
 */
import { normaliseGroup } from './schema.js';

/** Past this, messengers and browsers start truncating. Offer a file instead. */
export const MAX_LINK_LENGTH = 8000;

const PREFIX_DEFLATE = 'z';
const PREFIX_PLAIN = 'u';

function bytesToBase64Url(bytes) {
  let binary = '';
  // Chunked, because String.fromCharCode(...big array) overflows the stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 'deflate' rather than 'deflate-raw': the raw variant saves two bytes but is
// missing from some runtimes that otherwise have CompressionStream, and a
// share link that one side cannot read is worse than a slightly longer one.
const FORMAT = 'deflate';

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(FORMAT));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    // Compression is an optimisation, never a requirement: fall back to plain.
    return null;
  }
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read compressed share links.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(FORMAT));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Strip a group down to what a recipient actually needs. Timestamps and
 * recurring templates are left out: they roughly double the payload and mean
 * nothing on someone else's device, where the schedule would fire again.
 */
export function toSharePayload(group) {
  return {
    v: 1,
    n: group.name,
    t: group.type,
    c: [group.currency.code, group.currency.symbol],
    m: group.members.map((m) => [m.id, m.name, m.color]),
    e: group.expenses.map((e) => [
      e.id, e.title, e.category, e.date, e.amountMinor,
      e.payers.map((p) => [p.memberId, p.amountMinor]),
      Object.entries(e.owedMinor),
      e.split.mode,
      e.notes || '',
    ]),
    s: group.settlements.map((x) => [x.id, x.fromMemberId, x.toMemberId, x.amountMinor, x.date, x.notes || '']),
  };
}

/** Expand a payload back into a full group, then validate it like any input. */
export function fromSharePayload(payload) {
  if (!payload || payload.v !== 1) {
    throw new Error('This link was made by a different version of the app.');
  }

  const raw = {
    name: payload.n,
    type: payload.t,
    currency: { code: payload.c?.[0], symbol: payload.c?.[1] },
    members: (payload.m || []).map(([id, name, color]) => ({ id, name, color })),
    expenses: (payload.e || []).map(([id, title, category, date, amountMinor, payers, owed, mode, notes]) => ({
      id,
      title,
      category,
      date,
      amountMinor,
      notes,
      payers: (payers || []).map(([memberId, amount]) => ({ memberId, amountMinor: amount })),
      owedMinor: Object.fromEntries(owed || []),
      split: { mode, participants: [] },
    })),
    settlements: (payload.s || []).map(([id, fromMemberId, toMemberId, amountMinor, date, notes]) => ({
      id, fromMemberId, toMemberId, amountMinor, date, notes,
    })),
    recurring: [],
  };

  // normaliseGroup is the same gate used for stored data: it drops anything
  // incoherent rather than trusting the sender.
  return normaliseGroup(raw);
}

export async function encodeGroup(group) {
  const json = JSON.stringify(toSharePayload(group));
  const bytes = new TextEncoder().encode(json);

  const compressed = await deflate(bytes);
  if (compressed && compressed.length < bytes.length) {
    return PREFIX_DEFLATE + bytesToBase64Url(compressed);
  }
  return PREFIX_PLAIN + bytesToBase64Url(bytes);
}

export async function decodeGroup(code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) throw new Error('That share code is empty.');

  const prefix = trimmed[0];
  const body = trimmed.slice(1);
  if (prefix !== PREFIX_DEFLATE && prefix !== PREFIX_PLAIN) {
    throw new Error('That does not look like a share code.');
  }

  let bytes;
  try {
    bytes = base64UrlToBytes(body);
  } catch {
    throw new Error('That share code is damaged or incomplete.');
  }

  if (prefix === PREFIX_DEFLATE) {
    try {
      bytes = await inflate(bytes);
    } catch {
      throw new Error('That share code is damaged or incomplete.');
    }
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('That share code is damaged or incomplete.');
  }

  return fromSharePayload(payload);
}

/** Build the full URL a recipient can open. */
export function buildShareUrl(code, base = window.location.href) {
  const url = new URL(base);
  url.hash = `#/import/${code}`;
  return url.toString();
}

/** Pull a share code out of a URL fragment, if there is one. */
export function readShareCodeFromHash(hash = window.location.hash) {
  const match = /^#\/import\/(.+)$/.exec(hash || '');
  return match ? match[1] : null;
}

export async function encodeGroupLink(group, base) {
  const code = await encodeGroup(group);
  const url = buildShareUrl(code, base);
  return { code, url, tooLong: url.length > MAX_LINK_LENGTH };
}
