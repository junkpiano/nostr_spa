import type { NostrProfile, PubkeyHex, Npub, OGPResponse } from "../types/nostr.js";

export function shortenNpub(npub: Npub): string {
    return npub.slice(0, 12) + "...";
}

export function getAvatarURL(pubkey: PubkeyHex, profile: NostrProfile | null): string {
    return profile?.picture || `https://robohash.org/${pubkey}.png`;
}

export function getDisplayName(npub: Npub, profile: NostrProfile | null): string {
    return profile?.nip05 || profile?.name || shortenNpub(npub);
}

/**
 * Fetches Open Graph Protocol (OGP) metadata for a given URL
 * @param url - The URL to fetch OGP information for
 * @returns Promise resolving to OGP response object, or null if fetch fails
 */
export async function fetchOGP(url: string): Promise<OGPResponse | null> {
    try {
        const encodedURL: string = encodeURIComponent(url);
        const apiURL: string = `https://proxy.yusuke.cloud/api/ogp?url=${encodedURL}`;

        const response: Response = await fetch(apiURL);

        if (!response.ok) {
            console.error(`Failed to fetch OGP for ${url}: ${response.status} ${response.statusText}`);
            return null;
        }

        const data: OGPResponse = await response.json();
        return data;
    } catch (error: unknown) {
        console.error(`Error fetching OGP for ${url}:`, error);
        return null;
    }
}