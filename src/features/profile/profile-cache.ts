import type { NostrProfile, PubkeyHex } from "../../../types/nostr";

interface ProfileCacheStore {
  order: PubkeyHex[];
  items: Record<PubkeyHex, NostrProfile>;
}

const PROFILE_CACHE_KEY: string = "nostr_profile_cache_v1";
const PROFILE_CACHE_LIMIT: number = 100;

function readStore(): ProfileCacheStore {
  try {
    const raw: string | null = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) {
      return { order: [], items: {} };
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as ProfileCacheStore).order) ||
      typeof (parsed as ProfileCacheStore).items !== "object"
    ) {
      return { order: [], items: {} };
    }

    return parsed as ProfileCacheStore;
  } catch {
    return { order: [], items: {} };
  }
}

function writeStore(store: ProfileCacheStore): void {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(store));
  } catch (error: unknown) {
    console.warn("Failed to persist profile cache:", error);
  }
}

export function getCachedProfile(pubkey: PubkeyHex): NostrProfile | null {
  const store: ProfileCacheStore = readStore();
  const profile: NostrProfile | undefined = store.items[pubkey];
  if (!profile) {
    return null;
  }

  // LRU bump on read.
  store.order = store.order.filter((key: PubkeyHex): boolean => key !== pubkey);
  store.order.push(pubkey);
  writeStore(store);
  return profile;
}

export function setCachedProfile(pubkey: PubkeyHex, profile: NostrProfile): void {
  const store: ProfileCacheStore = readStore();

  store.items[pubkey] = profile;
  store.order = store.order.filter((key: PubkeyHex): boolean => key !== pubkey);
  store.order.push(pubkey);

  while (store.order.length > PROFILE_CACHE_LIMIT) {
    const oldestPubkey: PubkeyHex | undefined = store.order.shift();
    if (!oldestPubkey) {
      break;
    }
    delete store.items[oldestPubkey];
  }

  writeStore(store);
}
