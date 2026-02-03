import { nip19 } from "https://esm.sh/nostr-tools@2.17.0";
import { getAvatarURL, getDisplayName, fetchOGP, isTwitterURL, fetchTwitterEmbed, loadTwitterWidgets } from "./utils.js";
import { fetchProfile } from "./profile.js";
import type { NostrProfile, PubkeyHex, Npub, NostrEvent, OGPResponse } from "../types/nostr";

// Cache for profiles to avoid refetching
const profileCache: Map<PubkeyHex, NostrProfile | null> = new Map();
// Track which profiles are currently being fetched
const fetchingProfiles: Set<PubkeyHex> = new Set();

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

    // Extract URLs for OGP fetching
    const urls: string[] = [];
    const contentWithLinks: string = event.content.replace(
        /(https?:\/\/[^\s]+)/g,
        (url: string): string => {
            if (url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) {
                return `<img src="${url}" alt="Image" class="my-2 max-w-full rounded shadow" loading="lazy" />`;
            } else {
                urls.push(url);
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline">${url}</a>`;
            }
        }
    );

    const div: HTMLDivElement = document.createElement("div");
    div.className = "bg-gray-50 border border-gray-200 rounded p-4 shadow event-container";
    div.dataset.pubkey = pubkey;
    div.innerHTML = `
    <div class="flex items-start space-x-4">
      <a href="/${npub}" class="flex-shrink-0 hover:opacity-80 transition-opacity">
        <img src="${avatar}" alt="Avatar" class="event-avatar w-12 h-12 rounded-full object-cover cursor-pointer"
          onerror="this.src='https://placekitten.com/100/100';" />
      </a>
      <div class="flex-1 overflow-hidden">
        <a href="/${npub}" class="event-username font-semibold text-gray-800 text-sm mb-1 hover:text-blue-600 transition-colors inline-block">👤 ${name}</a>
        <div class="whitespace-pre-wrap break-words break-all mb-2 text-sm text-gray-700">${contentWithLinks}</div>
        <div class="ogp-container"></div>
        <div class="text-xs text-gray-500">🕒 ${createdAt}</div>
      </div>
    </div>
  `;
    output.appendChild(div);

    // Fetch and render OGP cards for non-image URLs
    if (urls.length > 0) {
        const ogpContainer: HTMLElement | null = div.querySelector(".ogp-container");
        if (ogpContainer) {
            urls.forEach(async (url: string): Promise<void> => {
                // Check if it's a Twitter/X URL and render embedded tweet
                if (isTwitterURL(url)) {
                    const embedHTML: string | null = await fetchTwitterEmbed(url);
                    if (embedHTML) {
                        renderTwitterEmbed(embedHTML, ogpContainer);
                        loadTwitterWidgets();
                    }
                } else {
                    const ogpData: OGPResponse | null = await fetchOGP(url);
                    if (ogpData && ogpData.data) {
                        renderOGPCard(ogpData, ogpContainer);
                    }
                }
            });
        }
    }
}

function renderOGPCard(ogpData: OGPResponse, container: HTMLElement): void {
    const title: string = ogpData.data["og:title"] || ogpData.data.title || "No title";
    const description: string = ogpData.data["og:description"] || ogpData.data.description || "";
    const image: string | undefined = ogpData.data["og:image"];
    const siteName: string = ogpData.data["og:site_name"] || "";
    const url: string = ogpData.url;

    const card: HTMLDivElement = document.createElement("div");
    card.className = "border border-gray-300 rounded-lg overflow-hidden my-2 hover:shadow-md transition-shadow bg-white";

    card.innerHTML = `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="block no-underline">
            ${image ? `<img src="${image}" alt="${title}" class="w-full h-48 object-cover" loading="lazy" onerror="this.style.display='none';" />` : ''}
            <div class="p-3">
                ${siteName ? `<div class="text-xs text-gray-500 mb-1">${siteName}</div>` : ''}
                <div class="font-semibold text-gray-900 text-sm mb-1 line-clamp-2">${title}</div>
                ${description ? `<div class="text-xs text-gray-600 line-clamp-2">${description}</div>` : ''}
            </div>
        </a>
    `;

    container.appendChild(card);
}

function renderTwitterEmbed(embedHTML: string, container: HTMLElement): void {
    const wrapper: HTMLDivElement = document.createElement("div");
    wrapper.className = "my-2";
    wrapper.innerHTML = embedHTML;
    container.appendChild(wrapper);
}

export async function loadGlobalTimeline(
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
        (loadMoreBtn as HTMLButtonElement).disabled = true;
        loadMoreBtn.classList.add("opacity-50", "cursor-not-allowed");
    }

    for (const relayUrl of relays) {
        const socket: WebSocket = new WebSocket(relayUrl);

        socket.onopen = (): void => {
            const subId: string = 'global-' + Math.random().toString(36).slice(2);
            const req: [string, string, { kinds: number[]; until: number; limit: number }] = [
                "REQ", subId,
                {
                    kinds: [1],
                    until: untilTimestamp,
                    limit: limit
                }
            ];
            socket.send(JSON.stringify(req));
        };

        socket.onmessage = async (msg: MessageEvent): Promise<void> => {
            const arr: any[] = JSON.parse(msg.data);
            if (arr[0] === "EVENT") {
                const event: NostrEvent = arr[2];
                if (seenEventIds.has(event.id)) return;
                seenEventIds.add(event.id);

                if (connectingMsg) {
                    connectingMsg.style.display = "none";
                }

                // Fetch profile for this event's author if not cached
                let profile: NostrProfile | null = profileCache.get(event.pubkey) || null;
                if (!profileCache.has(event.pubkey) && !fetchingProfiles.has(event.pubkey)) {
                    // Mark as being fetched to avoid duplicate requests
                    fetchingProfiles.add(event.pubkey);
                    // Fetch profile asynchronously
                    fetchProfile(event.pubkey, relays).then((fetchedProfile: NostrProfile | null): void => {
                        profileCache.set(event.pubkey, fetchedProfile);
                        fetchingProfiles.delete(event.pubkey);
                        // Update the rendered event with the fetched profile
                        // Find and update the event's display
                        const eventElements: NodeListOf<Element> = output.querySelectorAll('.event-container');
                        eventElements.forEach((el: Element): void => {
                            if ((el as HTMLElement).dataset.pubkey === event.pubkey) {
                                const nameEl: Element | null = el.querySelector('.event-username');
                                const avatarEl: Element | null = el.querySelector('.event-avatar');
                                if (fetchedProfile) {
                                    if (nameEl) {
                                        const npubStr: Npub = nip19.npubEncode(event.pubkey);
                                        nameEl.textContent = `👤 ${getDisplayName(npubStr, fetchedProfile)}`;
                                    }
                                    if (avatarEl) {
                                        (avatarEl as HTMLImageElement).src = getAvatarURL(event.pubkey, fetchedProfile);
                                    }
                                }
                            }
                        });
                    }).catch((err: any): void => {
                        console.error(`Failed to fetch profile for ${event.pubkey}`, err);
                        profileCache.set(event.pubkey, null);
                        fetchingProfiles.delete(event.pubkey);
                    });
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
                connectingMsg.style.display = "none";
            }
            if (loadMoreBtn) {
                (loadMoreBtn as HTMLButtonElement).disabled = false;
                loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
            }
        };
    }

    setTimeout((): void => {
        if (!anyEventLoaded && !output.querySelector("div")) {
            if(seenEventIds.size === 0) {
                output.innerHTML = "<p class='text-red-500'>No events found on global timeline.</p>";
            }
        }

        if (connectingMsg) {
            connectingMsg.style.display = "none";
        }

        if (loadMoreBtn) {
            (loadMoreBtn as HTMLButtonElement).disabled = false;
            loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
            loadMoreBtn.style.display = "inline";
        }
    }, 3000);

    if (loadMoreBtn) {
        // Remove old listeners and add new one
        const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(true) as HTMLElement;
        loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
        newLoadMoreBtn.addEventListener("click", (): Promise<void> => loadGlobalTimeline(relays, limit, untilTimestamp, seenEventIds, output, connectingMsg));
    }
}
