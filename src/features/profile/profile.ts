import { getAvatarURL, getDisplayName } from "../../utils/utils.js";
import { createRelayWebSocket } from "../../common/relay-socket.js";
import { recordRelayFailure } from "../relays/relays.js";
import { getCachedProfile, setCachedProfile } from "./profile-cache.js";
import type { NostrProfile, PubkeyHex, Npub } from "../../../types/nostr";

/**
 * Converts URLs in text to clickable links
 */
function convertUrlsToLinks(text: string): string {
    return text.replace(
        /(https?:\/\/[^\s]+)/g,
        (url: string): string => {
            // Escape HTML in the URL for display
            const displayUrl = url
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');

            return `<a href="${displayUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700 underline font-medium">${displayUrl}</a>`;
        }
    );
}

interface FetchProfileOptions {
    usePersistentCache?: boolean;
    persistProfile?: boolean;
}

const PROFILE_MEM_CACHE_TTL_MS: number = 5 * 60 * 1000;
const PROFILE_RETRY_INTERVAL_MS: number = 30 * 1000;
const profileMemoryCache: Map<PubkeyHex, { profile: NostrProfile | null; expiresAt: number }> = new Map();
const profileInFlight: Map<PubkeyHex, Promise<NostrProfile | null>> = new Map();
const profileLastAttempt: Map<PubkeyHex, number> = new Map();

export async function fetchProfile(
    pubkeyHex: PubkeyHex,
    relays: string[],
    options: FetchProfileOptions = {},
): Promise<NostrProfile | null> {
    const usePersistentCache: boolean = options.usePersistentCache !== false;
    const persistProfile: boolean = options.persistProfile !== false;
    const now: number = Date.now();

    const cachedMem: { profile: NostrProfile | null; expiresAt: number } | undefined = profileMemoryCache.get(pubkeyHex);
    if (cachedMem && cachedMem.expiresAt > now) {
        return cachedMem.profile;
    }

    if (usePersistentCache) {
        const cachedProfile: NostrProfile | null = getCachedProfile(pubkeyHex);
        if (cachedProfile) {
            profileMemoryCache.set(pubkeyHex, { profile: cachedProfile, expiresAt: now + PROFILE_MEM_CACHE_TTL_MS });
            return cachedProfile;
        }
    }

    if (relays.length === 0) {
        return null;
    }

    const existing: Promise<NostrProfile | null> | undefined = profileInFlight.get(pubkeyHex);
    if (existing) {
        return await existing;
    }

    const lastAttempt: number | undefined = profileLastAttempt.get(pubkeyHex);
    if (lastAttempt && now - lastAttempt < PROFILE_RETRY_INTERVAL_MS) {
        return null;
    }
    profileLastAttempt.set(pubkeyHex, now);

    const request: Promise<NostrProfile | null> = (async (): Promise<NostrProfile | null> => {
        for (const relayUrl of relays) {
            try {
                const profile: NostrProfile | null = await new Promise<NostrProfile | null>((resolve) => {
                    let settled: boolean = false;
                    const socket: WebSocket = createRelayWebSocket(relayUrl);

                const finish = (value: NostrProfile | null): void => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    socket.close();
                    resolve(value);
                };

                    const timeout = setTimeout((): void => {
                        recordRelayFailure(relayUrl);
                        finish(null);
                    }, 5000);

                    socket.onopen = (): void => {
                        const subId: string = "profile-" + Math.random().toString(36).slice(2);
                        const req: [string, string, { kinds: number[]; authors: string[]; limit: number }] = [
                            "REQ",
                            subId,
                            { kinds: [0], authors: [pubkeyHex], limit: 1 }
                        ];
                        socket.send(JSON.stringify(req));
                    };

                    socket.onmessage = (msg: MessageEvent): void => {
                        const arr: any[] = JSON.parse(msg.data);
                        if (arr[0] === "EVENT" && arr[2]?.kind === 0) {
                            try {
                                const parsed: NostrProfile = JSON.parse(arr[2].content);
                                finish(parsed);
                                return;
                            } catch (e) {
                                console.warn("Failed to parse profile JSON", e);
                            }
                        }

                        if (arr[0] === "EOSE") {
                            finish(null);
                        }
                    };

                    socket.onerror = (err: Event): void => {
                        console.error(`WebSocket error [${relayUrl}]`, err);
                        finish(null);
                    };
                });

                if (profile) {
                    if (persistProfile) {
                        setCachedProfile(pubkeyHex, profile);
                    }
                    profileMemoryCache.set(pubkeyHex, {
                        profile,
                        expiresAt: Date.now() + PROFILE_MEM_CACHE_TTL_MS,
                    });
                    return profile;
                }
            } catch (e) {
                console.warn(`Failed to fetch profile from ${relayUrl}`, e);
            }
        }
        profileMemoryCache.set(pubkeyHex, { profile: null, expiresAt: Date.now() + PROFILE_MEM_CACHE_TTL_MS });
        return null;
    })();

    profileInFlight.set(pubkeyHex, request);
    try {
        return await request;
    } finally {
        profileInFlight.delete(pubkeyHex);
    }
}

export function renderProfile(pubkey: PubkeyHex, npub: Npub, profile: NostrProfile | null, profileSection: HTMLElement): void {
    const avatar: string = getAvatarURL(pubkey, profile);
    const name: string = getDisplayName(npub, profile);
    const banner: string | undefined = profile?.banner;
    const isEnergySavingMode: boolean = localStorage.getItem("energy_saving_mode") === "true";

    // Convert URLs to links in bio
    const bioHtml: string = profile?.about
        ? convertUrlsToLinks(
            profile.about
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
        )
        : '';

    // Avatar HTML based on energy saving mode
    const avatarHtml: string = isEnergySavingMode
        ? `<div class="w-20 h-20 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 text-3xl mb-2 border-4 ${banner ? 'border-white shadow-lg' : 'border-gray-200'}">👤</div>`
        : `<img src="${avatar}" alt="Avatar" class="w-20 h-20 rounded-full object-cover mb-2 border-4 ${banner ? 'border-white shadow-lg' : 'border-gray-200'}"
            onerror="this.src='https://placekitten.com/100/100';" />`;

    // Banner HTML based on energy saving mode
    const bannerHtml: string = (banner && !isEnergySavingMode) ? `
        <div class="absolute inset-0 w-full h-full">
          <img src="${banner}" alt="Profile Banner" class="w-full h-full object-cover"
            onerror="this.style.display='none';" />
          <div class="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/70"></div>
        </div>
      ` : '';

    profileSection.innerHTML = `
    <div class="relative overflow-hidden rounded-lg">
      ${bannerHtml}
      <div class="relative flex flex-col items-center ${banner && !isEnergySavingMode ? 'py-12 px-4' : 'py-6'}">
        ${avatarHtml}
        <h2 class="font-bold text-lg ${banner && !isEnergySavingMode ? 'text-white drop-shadow-lg' : 'text-gray-900'}">${name}</h2>
        ${bioHtml ? `<p class="${banner && !isEnergySavingMode ? 'text-white/90 drop-shadow' : 'text-gray-600'} text-sm mt-1 text-center max-w-2xl break-words px-4 w-full whitespace-pre-wrap">${bioHtml}</p>` : ""}
        <div id="follow-action" class="mt-4"></div>
      </div>
    </div>
  `;
}
