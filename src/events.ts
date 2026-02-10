import { nip19 } from "https://esm.sh/nostr-tools@2.17.0";
import { getAvatarURL, getDisplayName } from "./utils.js";
import { fetchProfile } from "./profile.js";
import { renderEvent } from "./event-render.js";
import type { NostrProfile, PubkeyHex, Npub, NostrEvent, OGPResponse } from "../types/nostr";
export { fetchFollowList, fetchEventById, isEventDeleted } from "./events-queries.js";
export { renderEvent } from "./event-render.js";

// Cache for profiles to avoid refetching
const profileCache: Map<PubkeyHex, NostrProfile | null> = new Map();
// Track which profiles are currently being fetched
const fetchingProfiles: Set<PubkeyHex> = new Set();
const referencedEventCache: Map<string, Promise<NostrEvent | null>> = new Map();

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
    let clearedPlaceholder: boolean = false;
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

                if (!clearedPlaceholder) {
                    output.innerHTML = "";
                    clearedPlaceholder = true;
                }

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
        const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(true) as HTMLElement;
        loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
        newLoadMoreBtn.addEventListener(
            "click",
            (): Promise<void> =>
                loadEvents(pubkeyHex, profile, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg),
        );
    }
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
    let clearedPlaceholder: boolean = false;

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

                if (!clearedPlaceholder) {
                    output.innerHTML = "";
                    clearedPlaceholder = true;
                }

                if (connectingMsg) {
                    connectingMsg.style.display = "none";
                }

                // Fetch profile for this event's author if not cached
                let profile: NostrProfile | null = profileCache.get(event.pubkey) || null;
                if (!profileCache.has(event.pubkey) && !fetchingProfiles.has(event.pubkey)) {
                    // Mark as being fetched to avoid duplicate requests
                    fetchingProfiles.add(event.pubkey);
                    // Fetch profile asynchronously
                    fetchProfile(event.pubkey, relays, {
                        usePersistentCache: false,
                        persistProfile: false,
                    }).then((fetchedProfile: NostrProfile | null): void => {
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
    let pendingRelays: number = relays.length;
    const bufferedEvents: NostrEvent[] = [];
    const renderedEventIds: Set<string> = new Set();
    let finalized: boolean = false;
    let clearedPlaceholder: boolean = false;

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
        bufferedEvents.sort((a: NostrEvent, b: NostrEvent): number => b.created_at - a.created_at);

        if (!clearedPlaceholder && bufferedEvents.length > 0) {
            output.innerHTML = "";
            clearedPlaceholder = true;
        }

        bufferedEvents.forEach((event: NostrEvent): void => {
            if (renderedEventIds.has(event.id)) {
                return;
            }
            renderedEventIds.add(event.id);

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

        if (connectingMsg && renderedEventIds.size > 0) {
            connectingMsg.style.display = "none";
        }
    };

    const finalizeLoading = (): void => {
        if (finalized) {
            return;
        }
        finalized = true;
        flushBufferedEvents();

        if (renderedEventIds.size === 0 && seenEventIds.size === 0) {
            output.innerHTML = "<p class='text-red-500'>No posts found from selected kinds.</p>";
        }

        if (loadMoreBtn) {
            (loadMoreBtn as HTMLButtonElement).disabled = false;
            loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
            if (renderedEventIds.size > 0) {
                loadMoreBtn.style.display = "inline";
            }
        }

        if (connectingMsg) {
            connectingMsg.style.display = "none";
        }
    };

    const scheduleFlush = (): void => {
        if (flushScheduled) return;
        flushScheduled = true;
        const timeoutId = window.setTimeout((): void => {
            flushScheduled = false;
            flushBufferedEvents();
        }, 300);
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
                    finalizeLoading();
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
                finalizeLoading();
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
