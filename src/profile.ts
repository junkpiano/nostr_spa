import { getAvatarURL, getDisplayName } from "./utils";
import type { NostrProfile, PubkeyHex, Npub } from "../types/nostr";

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
      </div>
    </div>
  `;
}