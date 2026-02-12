import { nip19 } from 'nostr-tools';
import { renderEvent } from "../../common/event-render.js";
import { createRelayWebSocket } from "../../common/relay-socket.js";
import type { NostrProfile, PubkeyHex, Npub, NostrEvent } from "../../../types/nostr";
import {
  getCachedTimeline,
  storeEvents,
  prependEventsToTimeline,
  appendEventsToTimeline
} from "../../common/db/index.js";

export async function loadEvents(
  pubkeyHex: PubkeyHex,
  profile: NostrProfile | null,
  relays: string[],
  limit: number,
  untilTimestamp: number,
  seenEventIds: Set<string>,
  output: HTMLElement,
  connectingMsg: HTMLElement | null,
): Promise<void> {
  let anyEventLoaded: boolean = false;
  let clearedPlaceholder: boolean = false;
  const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");
  const bufferedEvents: NostrEvent[] = [];

  // === PHASE 2: Cache-first loading ===
  const isInitialLoad = untilTimestamp >= Date.now() / 1000 - 60; // Within last minute = initial load
  const originalUntilTimestamp = untilTimestamp; // Save original to ensure we fetch latest

  if (isInitialLoad) {
    try {
      const cached = await getCachedTimeline("user", pubkeyHex, { limit: 50 });
      if (cached.hasCache && cached.events.length > 0) {
        console.log(`[ProfileEvents] Loaded ${cached.events.length} events from cache`);
        clearedPlaceholder = true;
        output.innerHTML = "";

        for (const event of cached.events) {
          if (seenEventIds.has(event.id)) {
            continue;
          }
          seenEventIds.add(event.id);

          const npubStr: Npub = nip19.npubEncode(event.pubkey);
          renderEvent(event, profile, npubStr, event.pubkey, output);
          anyEventLoaded = true;
        }

        if (connectingMsg) {
          connectingMsg.style.display = "none";
        }

        // IMPORTANT: Don't update untilTimestamp from cache on initial load
        // We want to fetch the LATEST posts from relays, not continue from cache
        untilTimestamp = originalUntilTimestamp;
      }
    } catch (error) {
      console.error("[ProfileEvents] Failed to load from cache:", error);
    }
  }
  // === End cache-first loading ===

  if (connectingMsg && !clearedPlaceholder) {
    connectingMsg.style.display = ""; // Show connecting message
  }

  if (loadMoreBtn) {
    (loadMoreBtn as HTMLButtonElement).disabled = true; // Disable the button while loading
    loadMoreBtn.classList.add("opacity-50", "cursor-not-allowed"); // Add styles to indicate it's disabled
  }

  for (const relayUrl of relays) {
    const socket: WebSocket = createRelayWebSocket(relayUrl);

    socket.onopen = (): void => {
      const subId: string = "sub-" + Math.random().toString(36).slice(2);
      const req: [string, string, { kinds: number[]; authors: string[]; until: number; limit: number }] = [
        "REQ",
        subId,
        {
          kinds: [1, 6, 16],
          authors: [pubkeyHex],
          until: untilTimestamp,
          limit: limit,
        },
      ];
      socket.send(JSON.stringify(req));
    };

    socket.onmessage = (msg: MessageEvent): void => {
      const arr: any[] = JSON.parse(msg.data);
      if (arr[0] === "EVENT") {
        const event: NostrEvent = arr[2];
        if (seenEventIds.has(event.id)) return;
        seenEventIds.add(event.id);

        // === PHASE 2: Buffer events for batch storage ===
        bufferedEvents.push(event);
        // === End buffering ===

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
    // === PHASE 2: Store fetched events to cache ===
    if (bufferedEvents.length > 0) {
      storeEvents(bufferedEvents, { isHomeTimeline: false }).catch((error) => {
        console.error("[ProfileEvents] Failed to store events:", error);
      });

      const eventIds = bufferedEvents.map((e) => e.id);
      const timestamps = bufferedEvents.map((e) => e.created_at);
      const newestTimestamp = Math.max(...timestamps);
      const oldestTimestamp = Math.min(...timestamps);

      if (isInitialLoad) {
        prependEventsToTimeline("user", pubkeyHex, eventIds, newestTimestamp).catch((error) => {
          console.error("[ProfileEvents] Failed to update timeline:", error);
        });
      } else {
        appendEventsToTimeline("user", pubkeyHex, eventIds, oldestTimestamp).catch((error) => {
          console.error("[ProfileEvents] Failed to append to timeline:", error);
        });
      }
    }
    // === End event storage ===

    if (!anyEventLoaded && !output.querySelector("div")) {
      if (seenEventIds.size === 0) {
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
