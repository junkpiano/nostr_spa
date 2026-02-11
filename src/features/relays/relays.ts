const RELAYS_STORAGE_KEY: string = "nostr_relays";
const defaultRelays: string[] = [
  "wss://relay.snort.social",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://yabu.me",
];

let relays: string[] = loadRelaysFromStorage();

export function getRelays(): string[] {
  return relays;
}

export function setRelays(relayList: string[]): void {
  const unique: string[] = Array.from(new Set(relayList));
  localStorage.setItem(RELAYS_STORAGE_KEY, JSON.stringify(unique));
  relays = unique;
}

export function normalizeRelayUrl(rawUrl: string): string | null {
  const trimmed: string = rawUrl.trim();
  if (!trimmed) return null;

  const withScheme: string = trimmed.match(/^wss?:\/\//i) ? trimmed : `wss://${trimmed}`;
  try {
    const parsed: URL = new URL(withScheme);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return null;
    }
    let href: string = parsed.toString();
    if (href.endsWith("/") && parsed.pathname === "/") {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return null;
  }
}

function loadRelaysFromStorage(): string[] {
  try {
    const raw: string | null = localStorage.getItem(RELAYS_STORAGE_KEY);
    if (!raw) return [...defaultRelays];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...defaultRelays];
    const normalized: string[] = parsed
      .map((value: unknown): string | null => (typeof value === "string" ? normalizeRelayUrl(value) : null))
      .filter((value: string | null): value is string => Boolean(value));
    if (normalized.length === 0) return [...defaultRelays];
    return Array.from(new Set(normalized));
  } catch {
    return [...defaultRelays];
  }
}
