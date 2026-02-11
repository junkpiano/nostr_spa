import type { NostrProfile, PubkeyHex } from '../../types/nostr';

export const profileCache: Map<PubkeyHex, NostrProfile | null> = new Map();
export const fetchingProfiles: Set<PubkeyHex> = new Set();
