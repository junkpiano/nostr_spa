import { NostrProfile, PubkeyHex, Npub } from "../types/nostr.js";

export function shortenNpub(npub: Npub): string {
    return npub.slice(0, 12) + "...";
}

export function getAvatarURL(pubkey: PubkeyHex, profile: NostrProfile | null): string {
    return profile?.picture || `https://robohash.org/${pubkey}.png`;
}

export function getDisplayName(npub: Npub, profile: NostrProfile | null): string {
    return profile?.nip05 || profile?.name || shortenNpub(npub);
}