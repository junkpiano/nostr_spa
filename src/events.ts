import { nip19, finalizeEvent } from "https://esm.sh/nostr-tools@2.17.0";
import { getAvatarURL, getDisplayName, fetchOGP, isTwitterURL, fetchTwitterEmbed, loadTwitterWidgets } from "./utils.js";
import { fetchProfile } from "./profile.js";
import { getRelays } from "./relays.js";
import { getSessionPrivateKey } from "./session.js";
import type { NostrProfile, PubkeyHex, Npub, NostrEvent, OGPResponse } from "../types/nostr";

// Cache for profiles to avoid refetching
const profileCache: Map<PubkeyHex, NostrProfile | null> = new Map();
// Track which profiles are currently being fetched
const fetchingProfiles: Set<PubkeyHex> = new Set();

/**
 * Fetches the follow list (kind 3 event) for a given user
 * @param pubkeyHex - The hex public key of the user
 * @param relays - Array of relay URLs to query
 * @returns Promise resolving to array of followed pubkeys (hex format)
 */
export async function fetchFollowList(pubkeyHex: PubkeyHex, relays: string[]): Promise<PubkeyHex[]> {
    console.log(`Fetching follow list for ${pubkeyHex}`);
    let latestFollowTimestamp: number = -1;
    let latestFollowTags: string[][] = [];

    const relayResults: Map<string, { gotEvent: boolean; tagCount: number; createdAt: number | null }> = new Map();

    const promises = relays.map(async (relayUrl: string): Promise<void> => {
        try {
            const socket: WebSocket = new WebSocket(relayUrl);
            await new Promise<void>((resolve) => {
                let settled: boolean = false;
                const finish = (): void => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    socket.close();
                    resolve();
                };

                const timeout = setTimeout(() => {
                    finish();
                }, 8000);

                socket.onopen = (): void => {
                    const subId: string = "follows-" + Math.random().toString(36).slice(2);
                    const req: [string, string, { kinds: number[]; authors: string[]; limit: number }] = [
                        "REQ",
                        subId,
                        { kinds: [3], authors: [pubkeyHex], limit: 20 }
                    ];
                    console.log(`Requesting follows from ${relayUrl}`);
                    socket.send(JSON.stringify(req));
                };

                socket.onmessage = (msg: MessageEvent): void => {
                    const arr: any[] = JSON.parse(msg.data);
                    if (arr[0] === "EVENT" && arr[2]?.kind === 3) {
                        const event: NostrEvent = arr[2];
                        if (event.created_at >= latestFollowTimestamp) {
                            latestFollowTimestamp = event.created_at;
                            latestFollowTags = event.tags;
                        }
                        relayResults.set(relayUrl, {
                            gotEvent: true,
                            tagCount: event.tags.length,
                            createdAt: event.created_at,
                        });
                        console.log(
                            `Got kind 3 event from ${relayUrl} with ${event.tags.length} tags at ${event.created_at}`,
                        );
                    } else if (arr[0] === "EOSE") {
                        if (!relayResults.has(relayUrl)) {
                            relayResults.set(relayUrl, { gotEvent: false, tagCount: 0, createdAt: null });
                        }
                        finish();
                    }
                };

                socket.onerror = (err: Event): void => {
                    console.error(`WebSocket error [${relayUrl}]`, err);
                    finish();
                };
            });
        } catch (e) {
            console.warn(`Failed to fetch follows from ${relayUrl}:`, e);
        }
    });

    await Promise.allSettled(promises);

    const followedPubkeys: Set<PubkeyHex> = new Set();
    latestFollowTags.forEach((tag: string[]): void => {
        if (tag[0] === "p" && tag[1]) {
            followedPubkeys.add(tag[1] as PubkeyHex);
        }
    });

    console.log(`Follow list relay summary:`, Array.from(relayResults.entries()));
    console.log(
        `Using latest kind 3 event at ${latestFollowTimestamp >= 0 ? latestFollowTimestamp : "n/a"}, total follows: ${followedPubkeys.size}`,
    );
    return Array.from(followedPubkeys);
}

export async function fetchEventById(eventId: string, relays: string[]): Promise<NostrEvent | null> {
    for (const relayUrl of relays) {
        try {
            const socket: WebSocket = new WebSocket(relayUrl);
            const event: NostrEvent | null = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    socket.close();
                    reject(new Error("Timeout"));
                }, 5000);

                socket.onopen = (): void => {
                    const subId: string = "event-" + Math.random().toString(36).slice(2);
                    const req: [string, string, { ids: string[]; limit: number }] = [
                        "REQ",
                        subId,
                        { ids: [eventId], limit: 1 }
                    ];
                    socket.send(JSON.stringify(req));
                };

                socket.onmessage = (msg: MessageEvent): void => {
                    const arr: any[] = JSON.parse(msg.data);
                    if (arr[0] === "EVENT") {
                        clearTimeout(timeout);
                        socket.close();
                        resolve(arr[2] as NostrEvent);
                    } else if (arr[0] === "EOSE") {
                        clearTimeout(timeout);
                        socket.close();
                        resolve(null);
                    }
                };

                socket.onerror = (err: Event): void => {
                    clearTimeout(timeout);
                    socket.close();
                    reject(err);
                };
            });

            if (event) {
                return event;
            }
        } catch (e) {
            console.warn(`Failed to fetch event ${eventId} from ${relayUrl}:`, e);
        }
    }

    return null;
}

export async function isEventDeleted(
    eventId: string,
    authorPubkey: PubkeyHex,
    relays: string[],
): Promise<boolean> {
    const checks = relays.map(async (relayUrl: string): Promise<boolean> => {
        try {
            const socket: WebSocket = new WebSocket(relayUrl);
            return await new Promise<boolean>((resolve) => {
                let settled: boolean = false;
                const finish = (deleted: boolean): void => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    socket.close();
                    resolve(deleted);
                };

                const timeout = setTimeout(() => {
                    finish(false);
                }, 5000);

                socket.onopen = (): void => {
                    const subId: string = "deleted-" + Math.random().toString(36).slice(2);
                    const req: [string, string, { kinds: number[]; authors: string[]; "#e": string[]; limit: number }] = [
                        "REQ",
                        subId,
                        {
                            kinds: [5],
                            authors: [authorPubkey],
                            "#e": [eventId],
                            limit: 20,
                        },
                    ];
                    socket.send(JSON.stringify(req));
                };

                socket.onmessage = (msg: MessageEvent): void => {
                    const arr: any[] = JSON.parse(msg.data);
                    if (arr[0] === "EVENT" && arr[2]?.kind === 5) {
                        const deleteEvent: NostrEvent = arr[2];
                        const referencesTarget: boolean = deleteEvent.tags.some(
                            (tag: string[]): boolean => tag[0] === "e" && tag[1] === eventId,
                        );
                        if (referencesTarget) {
                            finish(true);
                            return;
                        }
                    } else if (arr[0] === "EOSE") {
                        finish(false);
                    }
                };

                socket.onerror = (): void => {
                    finish(false);
                };
            });
        } catch (e) {
            console.warn(`Failed to check delete event on ${relayUrl}:`, e);
            return false;
        }
    });

    const results: boolean[] = await Promise.all(checks);
    return results.some(Boolean);
}

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
    let eventPermalink: string | null = null;
    try {
        eventPermalink = `/${nip19.neventEncode({ id: event.id })}`;
    } catch (e) {
        console.warn("Failed to encode nevent for event link:", e);
        eventPermalink = null;
    }
    const dateHtml: string = eventPermalink
        ? `<a href="${eventPermalink}" class="text-xs text-gray-500 hover:text-blue-600 transition-colors">🕒 ${createdAt}</a>`
        : `<div class="text-xs text-gray-500">🕒 ${createdAt}</div>`;
    const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
    const canDeletePost: boolean = Boolean(storedPubkey && storedPubkey === event.pubkey);
    const deleteButtonHtml: string = canDeletePost
        ? `
          <button class="delete-event-btn text-red-500 hover:text-red-700 transition-colors p-1 rounded" aria-label="Delete post" title="Delete post">
            🗑️
          </button>
        `
        : "";

    // Extract URLs for OGP fetching and image overlay
    const urls: string[] = [];
    const imageUrls: string[] = [];
    const referencedNevents: string[] = Array.from(
        new Set(
            [...event.content.matchAll(/nostr:(nevent1[0-9a-z]+)/gi)]
                .map((match: RegExpMatchArray): string | undefined => match[1])
                .filter((value: string | undefined): value is string => Boolean(value))
        )
    );
    const contentWithNostrLinks: string = event.content.replace(
        /(nostr:nevent1[0-9a-z]+)/gi,
        (nevent: string): string => {
            const path: string = `/${nevent.replace(/^nostr:/i, "")}`;
            return `<a href="${path}" class="text-indigo-600 underline">${nevent}</a>`;
        }
    );

    const contentWithLinks: string = contentWithNostrLinks.replace(
        /(https?:\/\/[^\s]+)/g,
        (url: string): string => {
            if (url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) {
                const imageIndex: number = imageUrls.length;
                imageUrls.push(url);
                return `<img src="${url}" alt="Image" class="my-2 max-w-full rounded shadow cursor-zoom-in event-image" loading="lazy" data-image-index="${imageIndex}" />`;
            } else {
                urls.push(url);
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline">${url}</a>`;
            }
        }
    );

    const div: HTMLDivElement = document.createElement("div");
    div.className = "bg-gray-50 border border-gray-200 rounded p-4 shadow event-container";
    div.dataset.pubkey = pubkey;
    if (imageUrls.length > 0) {
        div.dataset.images = JSON.stringify(imageUrls);
    }
    div.innerHTML = `
	    <div class="flex items-start space-x-4">
      <a href="/${npub}" class="flex-shrink-0 hover:opacity-80 transition-opacity">
        <img src="${avatar}" alt="Avatar" class="event-avatar w-12 h-12 rounded-full object-cover cursor-pointer"
          onerror="this.src='https://placekitten.com/100/100';" />
      </a>
      <div class="flex-1 overflow-hidden">
        <a href="/${npub}" class="event-username font-semibold text-gray-800 text-sm mb-1 hover:text-blue-600 transition-colors inline-block">👤 ${name}</a>
	        <div class="whitespace-pre-wrap break-words break-all mb-2 text-sm text-gray-700">${contentWithLinks}</div>
            <div class="referenced-events-container space-y-2"></div>
	        <div class="ogp-container"></div>
            <div class="mt-2 flex items-center justify-between gap-2">
                ${dateHtml}
                ${deleteButtonHtml}
            </div>
	      </div>
	    </div>
	  `;
    output.appendChild(div);

    const deleteButton: HTMLButtonElement | null = div.querySelector(".delete-event-btn") as HTMLButtonElement | null;
    if (deleteButton) {
        deleteButton.addEventListener("click", async (): Promise<void> => {
            const confirmed: boolean = window.confirm("Delete this post?");
            if (!confirmed) {
                return;
            }

            deleteButton.disabled = true;
            deleteButton.classList.add("opacity-60", "cursor-not-allowed");

            try {
                await deleteEventOnRelays(event);
                div.remove();
            } catch (error: unknown) {
                console.error("Failed to delete event:", error);
                alert("Failed to delete post. Please try again.");
                deleteButton.disabled = false;
                deleteButton.classList.remove("opacity-60", "cursor-not-allowed");
            }
        });
    }

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

    if (referencedNevents.length > 0) {
        const referencedContainer: HTMLElement | null = div.querySelector(".referenced-events-container");
        if (referencedContainer) {
            renderReferencedEventCards(referencedNevents, referencedContainer);
        }
    }
}

async function deleteEventOnRelays(targetEvent: NostrEvent): Promise<void> {
    const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
    if (!storedPubkey || storedPubkey !== targetEvent.pubkey) {
        throw new Error("You can only delete your own posts.");
    }

    const unsignedEvent: Omit<NostrEvent, "id" | "sig"> = {
        kind: 5,
        pubkey: storedPubkey as PubkeyHex,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["e", targetEvent.id]],
        content: "",
    };

    let signedEvent: NostrEvent;
    if ((window as any).nostr && (window as any).nostr.signEvent) {
        signedEvent = await (window as any).nostr.signEvent(unsignedEvent);
    } else {
        const privateKey: Uint8Array | null = getSessionPrivateKey();
        if (!privateKey) {
            throw new Error("No signing method available");
        }
        signedEvent = finalizeEvent(unsignedEvent, privateKey) as NostrEvent;
    }

    const relays: string[] = getRelays();
    const publishPromises = relays.map(async (relayUrl: string): Promise<void> => {
        try {
            const socket: WebSocket = new WebSocket(relayUrl);
            await new Promise<void>((resolve) => {
                let settled: boolean = false;
                const finish = (): void => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    socket.close();
                    resolve();
                };

                const timeout = setTimeout(() => {
                    finish();
                }, 5000);

                socket.onopen = (): void => {
                    socket.send(JSON.stringify(["EVENT", signedEvent]));
                };

                socket.onmessage = (msg: MessageEvent): void => {
                    const arr: any[] = JSON.parse(msg.data);
                    if (arr[0] === "OK") {
                        finish();
                    }
                };

                socket.onerror = (): void => {
                    finish();
                };
            });
        } catch (e) {
            console.warn(`Failed to publish delete event to ${relayUrl}:`, e);
        }
    });

    await Promise.allSettled(publishPromises);
}

async function renderReferencedEventCards(nevents: string[], container: HTMLElement): Promise<void> {
    const currentRelays: string[] = getRelays();
    const maxCards: number = 3;

    for (const nevent of nevents.slice(0, maxCards)) {
        const card: HTMLDivElement = document.createElement("div");
        card.className = "border border-indigo-200 bg-indigo-50 rounded-lg p-3";
        card.textContent = "Loading referenced event...";
        container.appendChild(card);

        try {
            const decoded = nip19.decode(nevent);
            if (decoded.type !== "nevent") {
                card.textContent = "Referenced event is invalid.";
                continue;
            }

            const data: any = decoded.data;
            const eventId: string | undefined = data?.id || (typeof data === "string" ? data : undefined);
            const relayHints: string[] = Array.isArray(data?.relays) ? data.relays : [];
            if (!eventId) {
                card.textContent = "Referenced event ID is missing.";
                continue;
            }

            const relaysToUse: string[] = relayHints.length > 0 ? relayHints : currentRelays;
            const referencedEvent: NostrEvent | null = await fetchEventById(eventId, relaysToUse);
            if (!referencedEvent) {
                card.textContent = "Referenced event not found.";
                continue;
            }

            const referencedProfile: NostrProfile | null = await fetchProfile(referencedEvent.pubkey, relaysToUse);
            const referencedNpub: Npub = nip19.npubEncode(referencedEvent.pubkey);
            const referencedName: string = getDisplayName(referencedNpub, referencedProfile);
            const referencedAvatar: string = getAvatarURL(referencedEvent.pubkey, referencedProfile);
            const referencedText: string = referencedEvent.content.length > 180
                ? `${referencedEvent.content.slice(0, 180)}...`
                : referencedEvent.content;
            const referencedPath: string = `/${nevent}`;

            card.innerHTML = `
                <a href="${referencedPath}" class="block hover:bg-indigo-100 rounded transition-colors p-1">
                    <div class="flex items-start gap-2">
                        <img
                            src="${referencedAvatar}"
                            alt="${referencedName}"
                            class="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            onerror="this.src='https://placekitten.com/80/80';"
                        />
                        <div class="min-w-0">
                            <div class="text-xs text-gray-700 font-semibold mb-1 truncate">${referencedName}</div>
                            <div class="text-sm text-gray-800 whitespace-pre-wrap break-words">${referencedText || "(no content)"}</div>
                        </div>
                    </div>
                </a>
            `;
        } catch (error: unknown) {
            console.warn("Failed to render referenced event card:", error);
            card.textContent = "Failed to load referenced event.";
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
    connectingMsg: HTMLElement | null,
    activeWebSockets: WebSocket[] = [],
    activeTimeouts: number[] = []
): Promise<void> {
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
        activeWebSockets.push(socket);

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

    const timeoutId = window.setTimeout((): void => {
        // Only show error if no events exist in the DOM and seenEventIds is still empty
        const hasEvents = output.querySelectorAll('.event-container').length > 0;
        if (!hasEvents && seenEventIds.size === 0) {
            output.innerHTML = "<p class='text-red-500'>No events found on global timeline.</p>";
        }

        if (connectingMsg) {
            connectingMsg.style.display = "none";
        }

        if (loadMoreBtn) {
            (loadMoreBtn as HTMLButtonElement).disabled = false;
            loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
            // Only show load more button if we have events
            if (hasEvents || seenEventIds.size > 0) {
                loadMoreBtn.style.display = "inline";
            }
        }
    }, 5000); // Increased to 5 seconds to give more time for events to load
    activeTimeouts.push(timeoutId);

    if (loadMoreBtn) {
        // Remove old listeners and add new one
        const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(true) as HTMLElement;
        loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
        newLoadMoreBtn.addEventListener("click", (): Promise<void> => loadGlobalTimeline(relays, limit, untilTimestamp, seenEventIds, output, connectingMsg));
    }
}

export async function loadHomeTimeline(
    followedPubkeys: PubkeyHex[],
    kinds: number[],
    relays: string[],
    limit: number,
    untilTimestamp: number,
    seenEventIds: Set<string>,
    output: HTMLElement,
    connectingMsg: HTMLElement | null,
    activeWebSockets: WebSocket[] = [],
    activeTimeouts: number[] = []
): Promise<void> {
    let flushScheduled: boolean = false;
    let flushed: boolean = false;
    let pendingRelays: number = relays.length;
    const bufferedEvents: NostrEvent[] = [];

    if (followedPubkeys.length === 0) {
        if (output) {
            output.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-gray-700 mb-4">No authors specified for home timeline.</p>
                </div>
            `;
        }
        return;
    }

    const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");

    if (connectingMsg) {
        connectingMsg.style.display = ""; // Show connecting message
    }

    if (loadMoreBtn) {
        (loadMoreBtn as HTMLButtonElement).disabled = true;
        loadMoreBtn.classList.add("opacity-50", "cursor-not-allowed");
    }

    const flushBufferedEvents = (): void => {
        if (flushed) return;
        flushed = true;

        bufferedEvents.sort((a: NostrEvent, b: NostrEvent): number => b.created_at - a.created_at);

        bufferedEvents.forEach((event: NostrEvent): void => {
            // Fetch profile for this event's author if not cached
            let profile: NostrProfile | null = profileCache.get(event.pubkey) || null;
            if (!profileCache.has(event.pubkey) && !fetchingProfiles.has(event.pubkey)) {
                fetchingProfiles.add(event.pubkey);
                fetchProfile(event.pubkey, relays).then((fetchedProfile: NostrProfile | null): void => {
                    profileCache.set(event.pubkey, fetchedProfile);
                    fetchingProfiles.delete(event.pubkey);
                    // Update the rendered event with the fetched profile
                    const eventElements: NodeListOf<Element> = output.querySelectorAll(".event-container");
                    eventElements.forEach((el: Element): void => {
                        if ((el as HTMLElement).dataset.pubkey === event.pubkey) {
                            const nameEl: Element | null = el.querySelector(".event-username");
                            const avatarEl: Element | null = el.querySelector(".event-avatar");
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
        });

        if (connectingMsg) {
            connectingMsg.style.display = "none";
        }

        if (loadMoreBtn) {
            (loadMoreBtn as HTMLButtonElement).disabled = false;
            loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
            if (bufferedEvents.length > 0) {
                loadMoreBtn.style.display = "inline";
            }
        }
    };

    const scheduleFlush = (): void => {
        if (flushScheduled) return;
        flushScheduled = true;
        const timeoutId = window.setTimeout((): void => {
            if (!flushed) {
                flushBufferedEvents();
                if (bufferedEvents.length === 0 && seenEventIds.size === 0) {
                    output.innerHTML = "<p class='text-red-500'>No posts found from selected kinds.</p>";
                }
            }
        }, 5000);
        activeTimeouts.push(timeoutId);
    };

    for (const relayUrl of relays) {
        const socket: WebSocket = new WebSocket(relayUrl);
        activeWebSockets.push(socket);

        socket.onopen = (): void => {
            const subId: string = 'home-' + Math.random().toString(36).slice(2);
            const req: [string, string, { kinds: number[]; authors: string[]; until: number; limit: number }] = [
                "REQ", subId,
                {
                    kinds: kinds,
                    authors: followedPubkeys,
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

                bufferedEvents.push(event);
                scheduleFlush();
            } else if (arr[0] === "EOSE") {
                socket.close();
                pendingRelays -= 1;
                if (pendingRelays <= 0) {
                    flushBufferedEvents();
                } else {
                    scheduleFlush();
                }
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
            pendingRelays -= 1;
            if (pendingRelays <= 0) {
                flushBufferedEvents();
            } else {
                scheduleFlush();
            }
        };
    }

    if (loadMoreBtn) {
        // Remove old listeners and add new one
        const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(true) as HTMLElement;
        loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
        newLoadMoreBtn.addEventListener("click", (): Promise<void> => loadHomeTimeline(followedPubkeys, kinds, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg));
    }
}
