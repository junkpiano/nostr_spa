import { getAvatarURL, getDisplayName } from "./utils.js";
import type { NostrProfile, PubkeyHex, Npub } from "../types/nostr.js";

export async function fetchProfile(pubkeyHex: PubkeyHex, relays: string[]): Promise<NostrProfile | null> {
    let profile: NostrProfile | null = null;
    for (const relayUrl of relays) {
        try {
            const socket: WebSocket = new WebSocket(relayUrl);
            await new Promise<void>((resolve, reject) => {
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
                            profile = JSON.parse(arr[2].content);
                        } catch (e) {
                            console.warn("Failed to parse profile JSON", e);
                        }
                        socket.close();
                        resolve();
                    } else if (arr[0] === "EOSE") {
                        socket.close();
                        reject(new Error("No profile found"));
                    }
                };

                socket.onerror = (err: Event): void => {
                    console.error(`WebSocket error [${relayUrl}]`, err);
                    reject(err);
                };
            });
            break; // If success, stop trying others
        } catch (e) {
            console.warn(`Failed to fetch profile from ${relayUrl}, trying next...`);
        }
    }
    return profile;
}

export function renderProfile(pubkey: PubkeyHex, npub: Npub, profile: NostrProfile | null, profileSection: HTMLElement): void {
    const avatar: string = getAvatarURL(pubkey, profile);
    const name: string = getDisplayName(npub, profile);
    profileSection.innerHTML = `
    <div class="flex flex-col items-center">
      <img src="${avatar}" alt="Avatar" class="w-20 h-20 rounded-full object-cover mb-2"
        onerror="this.src='https://placekitten.com/100/100';" />
      <h2 class="font-bold text-lg">${name}</h2>
      ${profile?.about ? `<p class="text-gray-600 text-sm mt-1">${profile.about}</p>` : ""}
    </div>
  `;
}