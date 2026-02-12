import { nip19 } from 'nostr-tools';
import { getAvatarURL, getDisplayName } from "../../utils/utils.js";
import { fetchProfile } from "../profile/profile.js";
import { renderEvent } from "../../common/event-render.js";
import { fetchingProfiles, profileCache } from "../../common/timeline-cache.js";
import { createRelayWebSocket } from "../../common/relay-socket.js";
import type { NostrProfile, Npub, NostrEvent, PubkeyHex } from "../../../types/nostr";
import {
  getCachedTimeline,
  storeEvents,
  prependEventsToTimeline,
  appendEventsToTimeline,
  getProfile as getCachedProfile
} from "../../common/db/index.js";

export async function loadGlobalTimeline(
  relays: string[],
  limit: number,
  untilTimestamp: number,
  seenEventIds: Set<string>,
  output: HTMLElement,
  connectingMsg: HTMLElement | null,
  activeWebSockets: WebSocket[] = [],
  activeTimeouts: number[] = [],
  isRouteActive?: () => boolean,
): Promise<void> {
  const routeIsActive: () => boolean = isRouteActive || (() => true);
  if (!routeIsActive()) {
    return;
  }
  const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");
  let clearedPlaceholder: boolean = false;
  const bufferedEvents: NostrEvent[] = [];
  const renderedEventIds: Set<string> = new Set();

  // === PHASE 2: Cache-first loading ===
  const isInitialLoad = untilTimestamp >= Date.now() / 1000 - 60; // Within last minute = initial load
  const originalUntilTimestamp = untilTimestamp; // Save original to ensure we fetch latest

  if (isInitialLoad) {
    try {
      const cached = await getCachedTimeline("global", undefined, { limit: 50 });
      if (cached.hasCache && cached.events.length > 0) {
        console.log(`[GlobalTimeline] Loaded ${cached.events.length} events from cache`);
        if (!routeIsActive()) return; // Guard before DOM update
        clearedPlaceholder = true;
        output.innerHTML = "";

        for (const event of cached.events) {
          if (!routeIsActive()) return; // Guard before each render
          if (renderedEventIds.has(event.id) || seenEventIds.has(event.id)) {
            continue;
          }
          renderedEventIds.add(event.id);
          seenEventIds.add(event.id);

          let profile: NostrProfile | null = null;
          if (profileCache.has(event.pubkey)) {
            profile = profileCache.get(event.pubkey) || null;
          } else {
            profile = await getCachedProfile(event.pubkey as PubkeyHex);
            if (profile) {
              profileCache.set(event.pubkey, profile);
            }
          }

          const npubStr: Npub = nip19.npubEncode(event.pubkey);
          renderEvent(event, profile, npubStr, event.pubkey, output);
        }

        if (connectingMsg) {
          connectingMsg.style.display = "none";
        }

        // IMPORTANT: Don't update untilTimestamp from cache on initial load
        // We want to fetch the LATEST posts from relays, not continue from cache
        untilTimestamp = originalUntilTimestamp;
      }
    } catch (error) {
      console.error("[GlobalTimeline] Failed to load from cache:", error);
    }
  }
  // === End cache-first loading ===

  if (connectingMsg && !clearedPlaceholder) {
    connectingMsg.style.display = ""; // Show connecting message
  }

  if (loadMoreBtn) {
    (loadMoreBtn as HTMLButtonElement).disabled = true;
    loadMoreBtn.classList.add("opacity-50", "cursor-not-allowed");
  }

  for (const relayUrl of relays) {
    const socket: WebSocket = createRelayWebSocket(relayUrl);
    activeWebSockets.push(socket);

    socket.onopen = (): void => {
      if (!routeIsActive()) {
        socket.close();
        return;
      }
      const subId: string = "global-" + Math.random().toString(36).slice(2);
      const req: [string, string, { kinds: number[]; until: number; limit: number }] = [
        "REQ",
        subId,
        {
          kinds: [1, 6, 16],
          until: untilTimestamp,
          limit: limit,
        },
      ];
      socket.send(JSON.stringify(req));
    };

    socket.onmessage = async (msg: MessageEvent): Promise<void> => {
      if (!routeIsActive()) {
        return;
      }
      const arr: any[] = JSON.parse(msg.data);
      if (arr[0] === "EVENT") {
        const event: NostrEvent = arr[2];
        if (seenEventIds.has(event.id)) return;
        seenEventIds.add(event.id);

        // === PHASE 2: Buffer events for batch storage ===
        bufferedEvents.push(event);
        // === End buffering ===

        if (!clearedPlaceholder) {
          if (!routeIsActive()) return; // Guard before DOM update
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
          })
            .then((fetchedProfile: NostrProfile | null): void => {
              if (!routeIsActive()) return; // Guard before DOM update
              profileCache.set(event.pubkey, fetchedProfile);
              fetchingProfiles.delete(event.pubkey);
              // Update the rendered event with the fetched profile
              // Find and update the event's display
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
            })
            .catch((err: unknown): void => {
              console.error(`Failed to fetch profile for ${event.pubkey}`, err);
              profileCache.set(event.pubkey, null);
              fetchingProfiles.delete(event.pubkey);
            });
        }

        if (!routeIsActive()) return; // Guard before render
        const npubStr: Npub = nip19.npubEncode(event.pubkey);
        renderEvent(event, profile, npubStr, event.pubkey, output);
        untilTimestamp = Math.min(untilTimestamp, event.created_at);
      } else if (arr[0] === "EOSE") {
        socket.close();
      }
    };

    socket.onerror = (err: Event): void => {
      if (!routeIsActive()) {
        return;
      }
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
    if (!routeIsActive()) {
      return;
    }

    // === PHASE 2: Store fetched events to cache ===
    if (bufferedEvents.length > 0) {
      storeEvents(bufferedEvents, { isHomeTimeline: false }).catch((error) => {
        console.error("[GlobalTimeline] Failed to store events:", error);
      });

      const eventIds = bufferedEvents.map((e) => e.id);
      const timestamps = bufferedEvents.map((e) => e.created_at);
      const newestTimestamp = Math.max(...timestamps);
      const oldestTimestamp = Math.min(...timestamps);

      if (isInitialLoad) {
        prependEventsToTimeline("global", undefined, eventIds, newestTimestamp).catch((error) => {
          console.error("[GlobalTimeline] Failed to update timeline:", error);
        });
      } else {
        appendEventsToTimeline("global", undefined, eventIds, oldestTimestamp).catch((error) => {
          console.error("[GlobalTimeline] Failed to append to timeline:", error);
        });
      }
    }
    // === End event storage ===

    // Only show error if no events exist in the DOM and seenEventIds is still empty
    const hasEvents = output.querySelectorAll(".event-container").length > 0;
    if (!hasEvents && seenEventIds.size === 0) {
      if (!routeIsActive()) return; // Guard before DOM update
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
  }, 8000); // Safety timeout to ensure loading completes even if relays don't respond
  activeTimeouts.push(timeoutId);

  if (loadMoreBtn) {
    // Remove old listeners and add new one
    const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(true) as HTMLElement;
    loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
    newLoadMoreBtn.addEventListener("click", (): Promise<void> =>
      loadGlobalTimeline(
        relays,
        limit,
        untilTimestamp,
        seenEventIds,
        output,
        connectingMsg,
        activeWebSockets,
        activeTimeouts,
        routeIsActive,
      ),
    );
  }
}
