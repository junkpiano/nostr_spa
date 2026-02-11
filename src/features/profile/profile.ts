import { getAvatarURL, getDisplayName } from "../../utils/utils.js";
import { getCachedProfile, setCachedProfile } from "./profile-cache.js";
import type { NostrProfile, PubkeyHex, Npub } from "../../../types/nostr";

interface FetchProfileOptions {
    usePersistentCache?: boolean;
    persistProfile?: boolean;
}

export async function fetchProfile(
    pubkeyHex: PubkeyHex,
    relays: string[],
    options: FetchProfileOptions = {},
): Promise<NostrProfile | null> {
    const usePersistentCache: boolean = options.usePersistentCache !== false;
    const persistProfile: boolean = options.persistProfile !== false;

    if (usePersistentCache) {
        const cachedProfile: NostrProfile | null = getCachedProfile(pubkeyHex);
        if (cachedProfile) {
            return cachedProfile;
        }
    }

    if (relays.length === 0) {
        return null;
    }

    return await new Promise<NostrProfile | null>((resolve) => {
        let settled: boolean = false;
        let pending: number = relays.length;
        const sockets: WebSocket[] = [];

        const closeAll = (): void => {
            sockets.forEach((socket: WebSocket): void => {
                if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                    socket.close();
                }
            });
        };

        const finish = (profile: NostrProfile | null): void => {
            if (settled) return;
            settled = true;
            closeAll();
            resolve(profile);
        };

        relays.forEach((relayUrl: string): void => {
            try {
                const socket: WebSocket = new WebSocket(relayUrl);
                sockets.push(socket);

                const timeout = setTimeout((): void => {
                    pending -= 1;
                    if (pending <= 0) {
                        finish(null);
                    }
                }, 4000);

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
                        clearTimeout(timeout);
                        try {
                            const profile: NostrProfile = JSON.parse(arr[2].content);
                            if (persistProfile) {
                                setCachedProfile(pubkeyHex, profile);
                            }
                            finish(profile);
                            return;
                        } catch (e) {
                            console.warn("Failed to parse profile JSON", e);
                        }
                    }

                    if (arr[0] === "EOSE") {
                        clearTimeout(timeout);
                        pending -= 1;
                        if (pending <= 0) {
                            finish(null);
                        }
                    }
                };

                socket.onerror = (err: Event): void => {
                    console.error(`WebSocket error [${relayUrl}]`, err);
                    clearTimeout(timeout);
                    pending -= 1;
                    if (pending <= 0) {
                        finish(null);
                    }
                };
            } catch (e) {
                console.warn(`Failed to fetch profile from ${relayUrl}`, e);
                pending -= 1;
                if (pending <= 0) {
                    finish(null);
                }
            }
        });
    });
}

export function renderProfile(pubkey: PubkeyHex, npub: Npub, profile: NostrProfile | null, profileSection: HTMLElement): void {
    const avatar: string = getAvatarURL(pubkey, profile);
    const name: string = getDisplayName(npub, profile);
    const banner: string | undefined = profile?.banner;

    profileSection.innerHTML = `
    <div class="relative overflow-hidden rounded-lg">
      ${banner ? `
        <div class="absolute inset-0 w-full h-full">
          <img src="${banner}" alt="Profile Banner" class="w-full h-full object-cover"
            onerror="this.style.display='none';" />
          <div class="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/70"></div>
        </div>
      ` : ''}
      <div class="relative flex flex-col items-center ${banner ? 'py-12 px-4' : 'py-6'}">
        <img src="${avatar}" alt="Avatar" class="w-20 h-20 rounded-full object-cover mb-2 border-4 ${banner ? 'border-white shadow-lg' : 'border-gray-200'}"
          onerror="this.src='https://placekitten.com/100/100';" />
        <h2 class="font-bold text-lg ${banner ? 'text-white drop-shadow-lg' : 'text-gray-900'}">${name}</h2>
        ${profile?.about ? `<p class="${banner ? 'text-white/90 drop-shadow' : 'text-gray-600'} text-sm mt-1 text-center max-w-2xl">${profile.about}</p>` : ""}
        <div id="follow-action" class="mt-4"></div>
      </div>
    </div>
  `;
}
