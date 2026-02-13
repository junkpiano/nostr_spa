import { nip05 } from 'nostr-tools';
import type { PubkeyHex } from "../../types/nostr";

export function isNip05Identifier(str: string): boolean {
  return str.includes("@");
}

export async function resolveNip05(identifier: string): Promise<PubkeyHex | null> {
  try {
    const profile = await nip05.queryProfile(identifier);
    if (profile && profile.pubkey) {
      return profile.pubkey as PubkeyHex;
    }
    return null;
  } catch (error) {
    console.error("[NIP-05] Failed to resolve identifier:", identifier, error);
    return null;
  }
}
