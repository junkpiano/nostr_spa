#!/usr/bin/env node

import { SimplePool, nip19 } from 'nostr-tools';

const DEFAULT_TIMEOUT_MS = 5000;

function printUsage() {
  console.error(
    'Usage: node scripts/nip19-decode.js <nip19-string> [--timeout=ms] [--relays=wss://a,wss://b]',
  );
  console.error('Note: event fetch only uses trusted relays from --relays or NOSTR_RELAYS.');
}

function normalizeRelayUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return null;
    }
    let href = parsed.toString();
    if (href.endsWith('/') && parsed.pathname === '/') {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return null;
  }
}

function uniqueRelays(relays) {
  return Array.from(new Set(relays));
}

function parseCsvRelays(csv) {
  return uniqueRelays(
    csv
      .split(',')
      .map((value) => normalizeRelayUrl(value))
      .filter((value) => Boolean(value)),
  );
}

function parseArgs(args) {
  const parsed = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    trustedRelays: [],
  };

  args.forEach((arg) => {
    if (arg.startsWith('--timeout=')) {
      const rawTimeout = arg.slice('--timeout='.length).trim();
      const timeoutMs = Number(rawTimeout);
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        parsed.timeoutMs = timeoutMs;
      }
      return;
    }

    if (arg.startsWith('--relays=')) {
      const rawRelays = arg.slice('--relays='.length).trim();
      parsed.trustedRelays = parseCsvRelays(rawRelays);
    }
  });

  return parsed;
}

function getEventIdFromDecoded(decoded) {
  if (decoded.type === 'note' && typeof decoded.data === 'string') {
    return decoded.data;
  }
  if (decoded.type === 'nevent' && decoded.data && typeof decoded.data === 'object') {
    return typeof decoded.data.id === 'string' ? decoded.data.id : null;
  }
  return null;
}

function getAuthorHintFromDecoded(decoded) {
  if (decoded.type !== 'nevent' || !decoded.data || typeof decoded.data !== 'object') {
    return null;
  }

  return typeof decoded.data.author === 'string' ? decoded.data.author : null;
}

function getRelayHintsFromDecoded(decoded) {
  if (decoded.type !== 'nevent' || !decoded.data || typeof decoded.data !== 'object') {
    return [];
  }

  if (!Array.isArray(decoded.data.relays)) {
    return [];
  }

  return uniqueRelays(
    decoded.data.relays
      .map((value) => (typeof value === 'string' ? normalizeRelayUrl(value) : null))
      .filter((value) => Boolean(value)),
  );
}

function resolveTrustedRelays(cliTrustedRelays) {
  if (cliTrustedRelays.length > 0) {
    return cliTrustedRelays;
  }
  if (process.env.NOSTR_RELAYS) {
    return parseCsvRelays(process.env.NOSTR_RELAYS);
  }
  return [];
}

function resolveRelayList(decoded, trustedRelays) {
  const relayHints = getRelayHintsFromDecoded(decoded);
  const trustedRelaySet = new Set(trustedRelays);
  const matchedRelayHints = relayHints.filter((relayUrl) => trustedRelaySet.has(relayUrl));
  const ignoredRelayHints = relayHints.filter((relayUrl) => !trustedRelaySet.has(relayUrl));

  return {
    relaysToQuery: trustedRelays,
    relayHints,
    matchedRelayHints,
    ignoredRelayHints,
  };
}

function buildAuthorInfo(pubkey) {
  if (!pubkey || typeof pubkey !== 'string') {
    return null;
  }
  try {
    return {
      pubkey,
      npub: nip19.npubEncode(pubkey),
    };
  } catch {
    return {
      pubkey,
      npub: null,
    };
  }
}

async function fetchEventDetail(eventId, relays, timeoutMs) {
  const pool = new SimplePool();
  try {
    const event = await pool.get(relays, { ids: [eventId], limit: 1 }, { maxWait: timeoutMs });
    const seenOn = pool.seenOn.get(eventId);
    const seenRelays = seenOn ? Array.from(seenOn).map((relay) => relay.url) : [];
    return {
      event,
      seenRelays: uniqueRelays(seenRelays),
    };
  } finally {
    pool.close(relays);
    pool.destroy();
  }
}

function normalizeDecodedData(data) {
  if (data instanceof Uint8Array) {
    return Array.from(data);
  }

  if (Array.isArray(data)) {
    return data.map((item) => normalizeDecodedData(item));
  }

  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, normalizeDecodedData(value)]),
    );
  }

  return data;
}

const encodedValue = process.argv[2];
const cliArgs = process.argv.slice(3);

if (!encodedValue) {
  printUsage();
  process.exit(1);
}

try {
  const options = parseArgs(cliArgs);
  const decoded = nip19.decode(encodedValue);
  const output = {
    type: decoded.type,
    data: normalizeDecodedData(decoded.data),
  };

  const eventId = getEventIdFromDecoded(decoded);
  const authorHintPubkey = getAuthorHintFromDecoded(decoded);
  if (eventId) {
    const trustedRelays = resolveTrustedRelays(options.trustedRelays);
    const relayPolicy = resolveRelayList(decoded, trustedRelays);
    const shouldFetch = relayPolicy.relaysToQuery.length > 0;
    const fetched = shouldFetch
      ? await fetchEventDetail(eventId, relayPolicy.relaysToQuery, options.timeoutMs)
      : { event: null, seenRelays: [] };
    const authorFromEvent = fetched.event?.pubkey
      ? buildAuthorInfo(fetched.event.pubkey)
      : null;
    const authorHint = buildAuthorInfo(authorHintPubkey);

    output.fetch = {
      trustedRelays: relayPolicy.relaysToQuery,
      relayHints: relayPolicy.relayHints,
      matchedRelayHints: relayPolicy.matchedRelayHints,
      ignoredRelayHints: relayPolicy.ignoredRelayHints,
      attemptedRelays: relayPolicy.relaysToQuery,
      timeoutMs: options.timeoutMs,
      skipped: !shouldFetch,
      skippedReason: shouldFetch ? null : 'No trusted relays configured',
      found: Boolean(fetched.event),
      author: authorFromEvent || authorHint,
      authorSource: authorFromEvent ? 'event' : authorHint ? 'nevent-hint' : null,
      seenRelays: fetched.seenRelays,
      event: normalizeDecodedData(fetched.event),
    };
  }

  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error('Failed to decode/fetch NIP-19 details.');
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}
