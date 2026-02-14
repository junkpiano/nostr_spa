import { nip19 } from 'nostr-tools';
import type { ConnectionStatePacket, EventPacket } from 'rx-nostr';
import type { Subscription } from 'rxjs';
import type {
  NostrEvent,
  NostrProfile,
  Npub,
  PubkeyHex,
} from '../../../types/nostr';
import {
  appendEventsToTimeline,
  getProfile as getCachedProfile,
  getCachedTimeline,
  prependEventsToTimeline,
  storeEvents,
} from '../../common/db/index.js';
import { renderEvent } from '../../common/event-render.js';
import { fetchingProfiles, profileCache } from '../../common/timeline-cache.js';
import { getAvatarURL, getDisplayName } from '../../utils/utils.js';
import { fetchProfile } from '../profile/profile.js';
import { getRelays } from '../relays/relays.js';
import { createBackwardReq, getRxNostr } from '../relays/rx-nostr-client.js';

export async function loadGlobalTimeline(
  _relays: string[],
  limit: number,
  untilTimestamp: number,
  seenEventIds: Set<string>,
  output: HTMLElement,
  connectingMsg: HTMLElement | null,
  _activeWebSockets: WebSocket[] = [],
  activeTimeouts: number[] = [],
  isRouteActive?: () => boolean,
): Promise<void> {
  const relays = getRelays();
  const routeIsActive: () => boolean = isRouteActive || (() => true);
  if (!routeIsActive()) {
    return;
  }
  const loadMoreBtn: HTMLElement | null = document.getElementById('load-more');
  // If we're paginating ("Load more"), the output already has rendered events.
  // Never clear it in that case; only clear placeholder/loading content.
  let clearedPlaceholder: boolean =
    output.querySelectorAll('.event-container').length > 0;
  const bufferedEvents: NostrEvent[] = [];
  const renderedEventIds: Set<string> = new Set();
  let relayConnectionCount: number = 0;
  let eventsReceivedCount: number = 0;
  let relayCompletionCount: number = 0;

  // === PHASE 2: Cache-first loading ===
  const isInitialLoad = untilTimestamp >= Date.now() / 1000 - 60; // Within last minute = initial load
  const originalUntilTimestamp = untilTimestamp; // Save original to ensure we fetch latest

  if (isInitialLoad) {
    try {
      const cached = await getCachedTimeline('global', undefined, {
        limit: 50,
      });
      const cacheAgeMinutes = cached.hasCache
        ? Math.floor((Date.now() / 1000 - cached.newestTimestamp) / 60)
        : 0;

      // Only use cache if it's less than 10 minutes old
      const CACHE_MAX_AGE_MINUTES = 10;
      const isCacheStale = cacheAgeMinutes > CACHE_MAX_AGE_MINUTES;

      if (cached.hasCache && cached.events.length > 0) {
        console.log(
          `[GlobalTimeline] Loaded ${cached.events.length} events from cache (age: ${cacheAgeMinutes} minutes, ${isCacheStale ? 'STALE' : 'fresh'})`,
        );

        if (isCacheStale) {
          console.log(
            `[GlobalTimeline] Cache is stale (>${CACHE_MAX_AGE_MINUTES}m), skipping cache display`,
          );
          // Don't display stale cache, go straight to fresh relay fetch
        } else {
          if (!routeIsActive()) return; // Guard before DOM update
          clearedPlaceholder = true;
          output.innerHTML = '';

          // Check route once before loop to avoid partial state updates
          if (routeIsActive()) {
            for (const event of cached.events) {
              if (
                renderedEventIds.has(event.id) ||
                seenEventIds.has(event.id)
              ) {
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
          }

          if (connectingMsg) {
            connectingMsg.style.display = 'none';
          }

          // IMPORTANT: Don't update untilTimestamp from cache on initial load
          // We want to fetch the LATEST posts from relays, not continue from cache
          untilTimestamp = originalUntilTimestamp;
        }
      }
    } catch (error) {
      console.error('[GlobalTimeline] Failed to load from cache:', error);
    }
  }
  // === End cache-first loading ===

  if (connectingMsg && !clearedPlaceholder) {
    connectingMsg.style.display = ''; // Show connecting message
  }

  if (loadMoreBtn) {
    (loadMoreBtn as HTMLButtonElement).disabled = true;
    loadMoreBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }

  // Use rx-nostr to fetch events
  const rxNostr = getRxNostr();
  console.log('[GlobalTimeline] RxNostr instance:', {
    isInitialized: !!rxNostr,
    relaysConfigured: relays.length,
    relaysList: relays,
  });
  const req = createBackwardReq();

  // Emit the filter to start fetching
  const filter = {
    kinds: [1, 6, 16],
    until: untilTimestamp,
    limit: limit,
  };
  console.log(`[GlobalTimeline] Fetching events with filter:`, {
    kinds: filter.kinds,
    until: new Date(filter.until * 1000).toISOString(),
    limit: filter.limit,
    relaysCount: relays.length,
    isInitialLoad: isInitialLoad,
    cachedEventsCount: renderedEventIds.size,
  });

  let newEventsFromRelay: number = 0;
  const connectionSub: Subscription = rxNostr
    .createConnectionStateObservable()
    .subscribe({
      next: (state: ConnectionStatePacket): void => {
        console.log(`[GlobalTimeline] Relay ${state.from}:`, state.state);
        if (state.state === 'connected') {
          relayConnectionCount++;
        }
      },
    });
  console.log('[GlobalTimeline] Starting subscription for relays:', relays);
  const subscription = rxNostr.use(req, { relays }).subscribe({
    next: (packet: EventPacket) => {
      if (!routeIsActive()) {
        subscription.unsubscribe();
        connectionSub.unsubscribe();
        return;
      }

      eventsReceivedCount++;
      const event: NostrEvent = packet.event;
      const eventAge = Math.floor((Date.now() / 1000 - event.created_at) / 60); // minutes ago
      console.log(
        `[GlobalTimeline] Event #${eventsReceivedCount} from ${packet.from}:`,
        {
          eventId: event.id.slice(0, 8),
          kind: event.kind,
          age: `${eventAge}m ago`,
        },
      );

      if (seenEventIds.has(event.id)) {
        console.log(
          `[GlobalTimeline] Skipping duplicate event ${event.id.slice(0, 8)}`,
        );
        return;
      }
      seenEventIds.add(event.id);
      newEventsFromRelay++;

      // Buffer events for batch storage
      bufferedEvents.push(event);

      if (!clearedPlaceholder) {
        if (!routeIsActive()) return;
        output.innerHTML = '';
        clearedPlaceholder = true;
      }

      if (connectingMsg) {
        connectingMsg.style.display = 'none';
      }

      // Fetch profile for this event's author if not cached
      const profile: NostrProfile | null =
        profileCache.get(event.pubkey) || null;
      if (
        !profileCache.has(event.pubkey) &&
        !fetchingProfiles.has(event.pubkey)
      ) {
        fetchingProfiles.add(event.pubkey);
        fetchProfile(event.pubkey, relays, {
          usePersistentCache: false,
          persistProfile: false,
        })
          .then((fetchedProfile: NostrProfile | null): void => {
            if (!routeIsActive()) return;
            profileCache.set(event.pubkey, fetchedProfile);
            fetchingProfiles.delete(event.pubkey);

            // Update rendered event with fetched profile
            const eventElements: NodeListOf<Element> =
              output.querySelectorAll('.event-container');
            eventElements.forEach((el: Element): void => {
              if ((el as HTMLElement).dataset.pubkey === event.pubkey) {
                const nameEl: Element | null =
                  el.querySelector('.event-username');
                const avatarEl: Element | null =
                  el.querySelector('.event-avatar');
                if (fetchedProfile) {
                  if (nameEl) {
                    const npubStr: Npub = nip19.npubEncode(event.pubkey);
                    nameEl.textContent = `👤 ${getDisplayName(npubStr, fetchedProfile)}`;
                  }
                  if (avatarEl) {
                    (avatarEl as HTMLImageElement).src = getAvatarURL(
                      event.pubkey,
                      fetchedProfile,
                    );
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

      if (!routeIsActive()) return;
      const npubStr: Npub = nip19.npubEncode(event.pubkey);
      renderEvent(event, profile, npubStr, event.pubkey, output);
      untilTimestamp = Math.min(untilTimestamp, event.created_at);
    },
    error: (err) => {
      if (!routeIsActive()) return;
      console.error('[GlobalTimeline] Subscription error:', {
        error: err,
        eventsReceived: eventsReceivedCount,
        relayCompletions: relayCompletionCount,
      });
      connectionSub.unsubscribe();
      if (connectingMsg) {
        connectingMsg.style.display = 'none';
      }
      if (loadMoreBtn) {
        (loadMoreBtn as HTMLButtonElement).disabled = false;
        loadMoreBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    },
    complete: () => {
      relayCompletionCount = relays.length;
      console.log('[GlobalTimeline] Subscription complete (EOSE or timeout):', {
        newEventsFromRelay,
        eventsReceived: eventsReceivedCount,
        bufferedEvents: bufferedEvents.length,
        relaysUsed: relays.length,
      });
      connectionSub.unsubscribe();
    },
  });

  // Emit filter AFTER subscribe — rx-nostr uses a regular Subject, not ReplaySubject,
  // so emissions before subscription are lost
  req.emit(filter);

  const timeoutId = window.setTimeout((): void => {
    console.log('[GlobalTimeline] Timeout reached:', {
      eventsReceived: eventsReceivedCount,
      bufferedEvents: bufferedEvents.length,
      relayConnections: relayConnectionCount,
      seenEventIds: seenEventIds.size,
    });
    connectionSub.unsubscribe();
    if (!routeIsActive()) {
      return;
    }

    // === PHASE 2: Store fetched events to cache ===
    if (bufferedEvents.length > 0) {
      storeEvents(bufferedEvents, { isHomeTimeline: false }).catch((error) => {
        console.error('[GlobalTimeline] Failed to store events:', error);
      });

      const eventIds = bufferedEvents.map((e) => e.id);
      const timestamps = bufferedEvents.map((e) => e.created_at);
      const newestTimestamp = Math.max(...timestamps);
      const oldestTimestamp = Math.min(...timestamps);

      if (isInitialLoad) {
        prependEventsToTimeline(
          'global',
          undefined,
          eventIds,
          newestTimestamp,
        ).catch((error) => {
          console.error('[GlobalTimeline] Failed to update timeline:', error);
        });
      } else {
        appendEventsToTimeline(
          'global',
          undefined,
          eventIds,
          oldestTimestamp,
        ).catch((error) => {
          console.error(
            '[GlobalTimeline] Failed to append to timeline:',
            error,
          );
        });
      }
    }
    // === End event storage ===

    // Only show error if no events exist in the DOM and seenEventIds is still empty
    const hasEvents = output.querySelectorAll('.event-container').length > 0;
    if (!hasEvents && seenEventIds.size === 0) {
      if (!routeIsActive()) return; // Guard before DOM update
      console.warn('[GlobalTimeline] No events loaded:', {
        relayConnectionCount,
        eventsReceivedCount,
        relayCompletionCount,
        relays: relays.length,
        filter: { kinds: [1, 6, 16], until: untilTimestamp, limit },
      });
      output.innerHTML = `
        <div class="text-center py-8">
          <p class="text-gray-700 mb-4">No events found on global timeline.</p>
          <p class="text-gray-500 text-sm mb-2">This could mean:</p>
          <ul class="text-gray-500 text-sm list-disc list-inside mb-4">
            <li>Relays are not responding (check console)</li>
            <li>Network connectivity issues</li>
            <li>Relays are temporarily down</li>
          </ul>
          <p class="text-gray-600 text-sm">
            Try refreshing the page or check 
            <a href="/relays" class="text-indigo-600 hover:underline">Relay settings</a>.
          </p>
          <p class="text-gray-500 text-xs mt-4">
            Connected to ${relayConnectionCount}/${relays.length} relays
          </p>
        </div>
      `;
    }

    if (connectingMsg) {
      connectingMsg.style.display = 'none';
    }

    if (loadMoreBtn) {
      (loadMoreBtn as HTMLButtonElement).disabled = false;
      loadMoreBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      // Only show load more button if we have events
      if (hasEvents || seenEventIds.size > 0) {
        loadMoreBtn.style.display = 'inline';
      }
    }
  }, 8000); // Safety timeout to ensure loading completes even if relays don't respond
  activeTimeouts.push(timeoutId);

  if (loadMoreBtn) {
    // Remove old listeners and add new one
    const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(
      true,
    ) as HTMLElement;
    loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
    newLoadMoreBtn.addEventListener(
      'click',
      (): Promise<void> =>
        loadGlobalTimeline(
          relays,
          limit,
          untilTimestamp,
          seenEventIds,
          output,
          connectingMsg,
          [],
          activeTimeouts,
          routeIsActive,
        ),
    );
  }
}
