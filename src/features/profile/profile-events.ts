import { nip19 } from 'nostr-tools';
import type { EventPacket } from 'rx-nostr';
import { renderEvent } from "../../common/event-render.js";
import { getRxNostr, createBackwardReq } from "../relays/rx-nostr-client.js";
import { getRelays } from "../relays/relays.js";
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
  _relays: string[],
  limit: number,
  untilTimestamp: number,
  seenEventIds: Set<string>,
  output: HTMLElement,
  connectingMsg: HTMLElement | null,
  isRouteActive?: () => boolean,
): Promise<void> {
  const routeIsActive: () => boolean = isRouteActive || (() => true);
  const relays = getRelays();
  if (!routeIsActive()) {
    return;
  }
  let anyEventLoaded: boolean = false;
  let clearedPlaceholder: boolean = false;
  let finalized: boolean = false;
  const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");
  const bufferedEvents: NostrEvent[] = [];

  // === PHASE 2: Cache-first loading ===
  const isInitialLoad = untilTimestamp >= Date.now() / 1000 - 60; // Within last minute = initial load
  const originalUntilTimestamp = untilTimestamp; // Save original to ensure we fetch latest

  if (isInitialLoad) {
    try {
      const cached = await getCachedTimeline("user", pubkeyHex, { limit: 50 });
      const cacheAgeMinutes = cached.hasCache
        ? Math.floor((Date.now() / 1000 - cached.newestTimestamp) / 60)
        : 0;

      // Only use cache if it's less than 30 minutes old
      const CACHE_MAX_AGE_MINUTES = 30;
      const isCacheStale = cacheAgeMinutes > CACHE_MAX_AGE_MINUTES;

      if (cached.hasCache && cached.events.length > 0) {
        console.log(`[ProfileEvents] Loaded ${cached.events.length} events from cache (age: ${cacheAgeMinutes} minutes, ${isCacheStale ? 'STALE' : 'fresh'})`);

        if (isCacheStale) {
          console.log(`[ProfileEvents] Cache is stale (>${CACHE_MAX_AGE_MINUTES}m), skipping cache display`);
          // Don't display stale cache, go straight to fresh relay fetch
        } else {
          if (!routeIsActive()) return; // Guard before DOM update
          clearedPlaceholder = true;
          output.innerHTML = "";

          // Check route once before loop to avoid partial state updates
          if (routeIsActive()) {
            for (const event of cached.events) {
            if (seenEventIds.has(event.id)) {
              continue;
            }
            seenEventIds.add(event.id);

            const npubStr: Npub = nip19.npubEncode(event.pubkey);
            renderEvent(event, profile, npubStr, event.pubkey, output);
              anyEventLoaded = true;
            }
          }

          if (connectingMsg) {
            connectingMsg.style.display = "none";
          }

          // IMPORTANT: Don't update untilTimestamp from cache on initial load
          // We want to fetch the LATEST posts from relays, not continue from cache
          untilTimestamp = originalUntilTimestamp;
        }
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

  // Use rx-nostr to fetch events
  const rxNostr = getRxNostr();
  const req = createBackwardReq();

  // Emit the filter to start fetching
  const filter = {
    kinds: [1, 6, 16],
    authors: [pubkeyHex],
    until: untilTimestamp,
    limit: limit,
  };
  console.log(`[ProfileEvents] Fetching events with filter:`, {
    kinds: filter.kinds,
    authorsCount: filter.authors.length,
    until: new Date(filter.until * 1000).toISOString(),
    limit: filter.limit,
    relaysCount: relays.length,
  });

  const finalizeLoading = (): void => {
    if (!routeIsActive()) {
      return;
    }
    if (finalized) {
      return;
    }
    finalized = true;

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

    // Check for actual event containers, not loading spinners
    const hasRenderedEvents = output.querySelectorAll(".event-container").length > 0;

    if (!anyEventLoaded && !hasRenderedEvents && seenEventIds.size === 0) {
      if (!routeIsActive()) return; // Guard before DOM update
      console.warn(`[ProfileEvents] No events found for user: ${pubkeyHex}`);
      output.innerHTML = `
        <div class="text-center py-8">
          <p class="text-gray-700 mb-4">No posts found for this user.</p>
          <p class="text-gray-500 text-sm">This user may not have posted yet, or relays are not responding.</p>
        </div>
      `;
    }

    if (connectingMsg) {
      connectingMsg.style.display = "none";
    }

    if (loadMoreBtn) {
      (loadMoreBtn as HTMLButtonElement).disabled = false;
      loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
      if (hasRenderedEvents) {
        loadMoreBtn.style.display = "inline";
      }
    }
  };

  const subscription = rxNostr.use(req, { relays }).subscribe({
    next: (packet: EventPacket) => {
      if (!routeIsActive()) {
        subscription.unsubscribe();
        return;
      }

      const event: NostrEvent = packet.event;
      if (seenEventIds.has(event.id)) return;
      seenEventIds.add(event.id);

      bufferedEvents.push(event);

      if (!clearedPlaceholder) {
        if (!routeIsActive()) return;
        output.innerHTML = "";
        clearedPlaceholder = true;
      }

      if (connectingMsg) {
        connectingMsg.style.display = "none";
      }

      if (!routeIsActive()) return;
      const npubStr: Npub = nip19.npubEncode(event.pubkey);
      renderEvent(event, profile, npubStr, event.pubkey, output);
      untilTimestamp = Math.min(untilTimestamp, event.created_at);
      anyEventLoaded = true;
    },
    error: (err) => {
      if (!routeIsActive()) return;
      console.error('[ProfileEvents] Subscription error:', err);
      if (connectingMsg) {
        connectingMsg.style.display = "none";
      }
      if (loadMoreBtn) {
        (loadMoreBtn as HTMLButtonElement).disabled = false;
        loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
      }
      if (!finalized) {
        finalizeLoading();
      }
    },
    complete: () => {
      console.log(`[ProfileEvents] Subscription complete. Received ${bufferedEvents.length} events.`);
      if (!finalized) {
        finalizeLoading();
      }
    }
  });

  // Emit filter AFTER subscribe — rx-nostr uses a regular Subject, not ReplaySubject,
  // so emissions before subscription are lost
  req.emit(filter);

  window.setTimeout((): void => {
    if (!finalized) {
      console.warn("[ProfileEvents] Timeline loading timed out, forcing finalization");
      finalizeLoading();
    }
  }, 8000);

  if (loadMoreBtn) {
    const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(true) as HTMLElement;
    loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
    newLoadMoreBtn.addEventListener(
      "click",
      (): Promise<void> =>
        loadEvents(pubkeyHex, profile, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, routeIsActive),
    );
  }
}
