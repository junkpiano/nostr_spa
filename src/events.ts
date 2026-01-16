import { nip19 } from "https://esm.sh/nostr-tools";
import { getAvatarURL, getDisplayName } from "./utils.js";
import { NostrProfile, PubkeyHex, Npub, NostrEvent } from "../types/nostr.js";

export async function loadEvents(
    pubkeyHex: PubkeyHex,
    profile: NostrProfile | null,
    relays: string[],
    limit: number,
    untilTimestamp: number,
    seenEventIds: Set<string>,
    output: HTMLElement,
    connectingMsg: HTMLElement | null
): Promise<void> {
    let anyEventLoaded: boolean = false;
    const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");

    if (connectingMsg) {
        connectingMsg.style.display = ""; // Show connecting message
    }

    if (loadMoreBtn) {
        (loadMoreBtn as HTMLButtonElement).disabled = true; // Disable the button while loading
        loadMoreBtn.classList.add("opacity-50", "cursor-not-allowed"); // Add styles to indicate it's disabled
    }

    for (const relayUrl of relays) {
        const socket: WebSocket = new WebSocket(relayUrl);

        socket.onopen = (): void => {
            const subId: string = 'sub-' + Math.random().toString(36).slice(2);
            const req: [string, string, { kinds: number[]; authors: string[]; until: number; limit: number }] = [
                "REQ", subId,
                {
                    kinds: [1],
                    authors: [pubkeyHex],
                    until: untilTimestamp,
                    limit: limit
                }
            ];
            socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
            const arr: any[] = JSON.parse(msg.data);
            if (arr[0] === "EVENT") {
                const event: NostrEvent = arr[2];
                if (seenEventIds.has(event.id)) return;
                seenEventIds.add(event.id);

                if (connectingMsg) {
                    connectingMsg.style.display = "none"; // Hide connecting message once events start loading
                }

                const npubStr: Npub = nip19.npubEncode(event.pubkey);
                renderEvent(event, profile, npubStr, event.pubkey, output);
                untilTimestamp = Math.min(untilTimestamp, event.created_at);
                anyEventLoaded = true;
            } else if (arr[0] === "EOSE") {
                socket.close();
            }
        };

        socket.onerror = (err: Event): void => {
            console.error(`WebSocket error [${relayUrl}]`, err);
            if (connectingMsg) {
                connectingMsg.style.display = "none"; // Hide connecting message if an error occurs
            }
            if (loadMoreBtn) {
                (loadMoreBtn as HTMLButtonElement).disabled = false; // Re-enable the button even if a relay fails
                loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
            }
        };
    }

    setTimeout((): void => {
        if (!anyEventLoaded && !output.querySelector("div")) {
            if(seenEventIds.size === 0) {
                output.innerHTML = "<p class='text-red-500'>No events found for this user.</p>";
            }
        }

        if (connectingMsg) {
            connectingMsg.style.display = "none"; // Ensure connecting message is hidden after timeout
        }

        if (loadMoreBtn) {
            (loadMoreBtn as HTMLButtonElement).disabled = false; // Re-enable the button after loading
            loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed"); // Remove disabled styles
            loadMoreBtn.style.display = "inline"; // Show the button again
        }
    }, 3000);

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", (): Promise<void> => loadEvents(pubkeyHex, profile, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg));
    }
}

export function renderEvent(event: NostrEvent, profile: NostrProfile | null, npub: Npub, pubkey: PubkeyHex, output: HTMLElement): void {
    const avatar: string = getAvatarURL(pubkey, profile);
    const name: string = getDisplayName(npub, profile);
    const createdAt: string = new Date(event.created_at * 1000).toLocaleString();

    const contentWithLinks: string = event.content.replace(
        /(https?:\/\/[^\s]+)/g,
        (url: string): string => {
            if (url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) {
                return `<img src="${url}" alt="Image" class="my-2 max-w-full rounded shadow" loading="lazy" />`;
            } else {
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline">${url}</a>`;
            }
        }
    );

    const div: HTMLDivElement = document.createElement("div");
    div.className = "bg-gray-50 border border-gray-200 rounded p-4 shadow";
    div.innerHTML = `
    <div class="flex items-start space-x-4">
      <img src="${avatar}" alt="Avatar" class="w-12 h-12 rounded-full object-cover"
        onerror="this.src='https://placekitten.com/100/100';" />
      <div class="flex-1 overflow-hidden">
        <div class="font-semibold text-gray-800 text-sm mb-1">👤 ${name}</div>
        <div class="whitespace-pre-wrap break-words break-all mb-2 text-sm text-gray-700">${contentWithLinks}</div>
        <div class="text-xs text-gray-500">🕒 ${createdAt}</div>
      </div>
    </div>
  `;
    output.appendChild(div);
}