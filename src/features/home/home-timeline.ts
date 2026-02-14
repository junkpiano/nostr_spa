import { nip19 } from 'nostr-tools';
import type { EventPacket } from 'rx-nostr';
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

export async function loadHomeTimeline(
  followedPubkeys: PubkeyHex[],
  kinds: number[],
  _relays: string[],
  limit: number,
  untilTimestamp: number,
  seenEventIds: Set<string>,
  output: HTMLElement,
  connectingMsg: HTMLElement | null,
  _activeWebSockets: WebSocket[] = [],
  activeTimeouts: number[] = [],
  isRouteActive?: () => boolean,
  userPubkey?: PubkeyHex | undefined,
): Promise<void> {
  const routeIsActive: () => boolean = isRouteActive || (() => true);
  const relays = getRelays();
  if (!routeIsActive()) {
    return;
  }
  let flushScheduled: boolean = false;
  const _pendingRelays: number = relays.length;
  const bufferedEvents: NostrEvent[] = [];
  const renderedEventIds: Set<string> = new Set();
  let finalized: boolean = false;
  let clearedPlaceholder: boolean = false;

  if (followedPubkeys.length === 0) {
    if (output) {
      if (!routeIsActive()) return; // Guard before DOM update
      output.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-gray-700 mb-4">No authors specified for home timeline.</p>
                </div>
            `;
    }
    return;
  }

  // === PHASE 2: Cache-first loading ===
  // Load cached timeline immediately if this is the initial load (untilTimestamp is current time)
  const isInitialLoad = untilTimestamp >= Date.now() / 1000 - 60; // Within last minute = initial load
  const originalUntilTimestamp = untilTimestamp; // Save original to ensure we fetch latest

  if (isInitialLoad && userPubkey) {
    try {
      const cached = await getCachedTimeline('home', userPubkey, { limit: 50 });
      const cacheAgeMinutes = cached.hasCache
        ? Math.floor((Date.now() / 1000 - cached.newestTimestamp) / 60)
        : 0;

      // Only use cache if it's less than 30 minutes old (home timeline can be slightly older)
      const CACHE_MAX_AGE_MINUTES = 30;
      const isCacheStale = cacheAgeMinutes > CACHE_MAX_AGE_MINUTES;

      if (cached.hasCache && cached.events.length > 0) {
        console.log(
          `[HomeTimeline] Loaded ${cached.events.length} events from cache (age: ${cacheAgeMinutes} minutes, ${isCacheStale ? 'STALE' : 'fresh'})`,
        );

        if (isCacheStale) {
          console.log(
            `[HomeTimeline] Cache is stale (>${CACHE_MAX_AGE_MINUTES}m), skipping cache display`,
          );
          // Don't display stale cache, go straight to fresh relay fetch
        } else {
          if (!routeIsActive()) return; // Guard before DOM update
          clearedPlaceholder = true;
          output.innerHTML = '';

          // Render cached events
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

              // Try to get profile from IndexedDB cache
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

          // Hide connecting message since we have cached content
          if (connectingMsg) {
            connectingMsg.style.display = 'none';
          }

          // IMPORTANT: Don't update untilTimestamp from cache on initial load
          // We want to fetch the LATEST posts from relays, not continue from cache
          untilTimestamp = originalUntilTimestamp;
        }
      }
    } catch (error) {
      console.error('[HomeTimeline] Failed to load from cache:', error);
      // Continue with relay fetch
    }
  }
  // === End cache-first loading ===

  const loadMoreBtn: HTMLElement | null = document.getElementById('load-more');

  if (connectingMsg) {
    connectingMsg.style.display = ''; // Show connecting message
  }

  if (loadMoreBtn) {
    (loadMoreBtn as HTMLButtonElement).disabled = true;
    loadMoreBtn.classList.add('opacity-50', 'cursor-not-allowed');
  }

  const flushBufferedEvents = (): void => {
    if (!routeIsActive()) {
      return;
    }
    bufferedEvents.sort(
      (a: NostrEvent, b: NostrEvent): number => b.created_at - a.created_at,
    );

    if (!clearedPlaceholder && bufferedEvents.length > 0) {
      if (!routeIsActive()) return; // Guard before DOM update
      output.innerHTML = '';
      clearedPlaceholder = true;
    }

    bufferedEvents.forEach((event: NostrEvent): void => {
      if (!routeIsActive()) return; // Guard before each render
      if (renderedEventIds.has(event.id)) {
        return;
      }
      renderedEventIds.add(event.id);

      // Fetch profile for this event's author if not cached
      const profile: NostrProfile | null =
        profileCache.get(event.pubkey) || null;
      if (
        !profileCache.has(event.pubkey) &&
        !fetchingProfiles.has(event.pubkey)
      ) {
        fetchingProfiles.add(event.pubkey);
        fetchProfile(event.pubkey, relays)
          .then((fetchedProfile: NostrProfile | null): void => {
            if (!routeIsActive()) return; // Guard before DOM update
            profileCache.set(event.pubkey, fetchedProfile);
            fetchingProfiles.delete(event.pubkey);
            // Update the rendered event with the fetched profile
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

      const npubStr: Npub = nip19.npubEncode(event.pubkey);
      renderEvent(event, profile, npubStr, event.pubkey, output);
      untilTimestamp = Math.min(untilTimestamp, event.created_at);
    });

    if (connectingMsg && renderedEventIds.size > 0) {
      connectingMsg.style.display = 'none';
    }
  };

  const finalizeLoading = (): void => {
    if (!routeIsActive()) {
      return;
    }
    if (finalized) {
      return;
    }
    finalized = true;
    flushBufferedEvents();

    // === PHASE 2: Store fetched events to cache ===
    if (bufferedEvents.length > 0 && userPubkey) {
      storeEvents(bufferedEvents, { isHomeTimeline: true }).catch((error) => {
        console.error('[HomeTimeline] Failed to store events:', error);
      });

      // Update timeline index
      const eventIds = bufferedEvents.map((e) => e.id);
      const timestamps = bufferedEvents.map((e) => e.created_at);
      const newestTimestamp = Math.max(...timestamps);
      const oldestTimestamp = Math.min(...timestamps);

      if (isInitialLoad) {
        // Initial load: prepend new events
        prependEventsToTimeline(
          'home',
          userPubkey,
          eventIds,
          newestTimestamp,
        ).catch((error) => {
          console.error('[HomeTimeline] Failed to update timeline:', error);
        });
      } else {
        // Pagination: append older events
        appendEventsToTimeline(
          'home',
          userPubkey,
          eventIds,
          oldestTimestamp,
        ).catch((error) => {
          console.error('[HomeTimeline] Failed to append to timeline:', error);
        });
      }
    }
    // === End event storage ===

    if (renderedEventIds.size === 0 && seenEventIds.size === 0) {
      if (!routeIsActive()) return; // Guard before DOM update
      console.warn(
        `[HomeTimeline] No events found. Authors: ${followedPubkeys.length}, Kinds: ${kinds.join(', ')}, Relays: ${relays.length}`,
      );
      output.innerHTML = `
        <div class="text-center py-8">
          <p class="text-gray-700 mb-4">No posts found in your home timeline.</p>
          <p class="text-gray-500 text-sm mb-2">This could mean:</p>
          <ul class="text-gray-500 text-sm list-disc list-inside mb-4">
            <li>The people you follow haven't posted recently</li>
            <li>Your relays are not responding</li>
            <li>You're not following anyone yet</li>
          </ul>
          <p class="text-gray-600 text-sm">Try viewing the <a href="/global" class="text-indigo-600 hover:underline">Global Timeline</a> or check your <a href="/relays" class="text-indigo-600 hover:underline">Relay settings</a>.</p>
        </div>
      `;
    }

    if (loadMoreBtn) {
      (loadMoreBtn as HTMLButtonElement).disabled = false;
      loadMoreBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      if (renderedEventIds.size > 0) {
        loadMoreBtn.style.display = 'inline';
      }
    }

    if (connectingMsg) {
      connectingMsg.style.display = 'none';
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

  // Safety timeout to ensure loading completes even if relays don't respond
  const safetyTimeoutId = window.setTimeout((): void => {
    if (!finalized) {
      console.warn('Timeline loading timed out, forcing finalization');
      finalizeLoading();
    }
  }, 8000);
  activeTimeouts.push(safetyTimeoutId);

  // Use rx-nostr to fetch events
  const rxNostr = getRxNostr();
  const req = createBackwardReq();

  // Emit the filter to start fetching
  const filter = {
    kinds: kinds,
    authors: followedPubkeys,
    until: untilTimestamp,
    limit: limit,
  };
  console.log(`[HomeTimeline] Fetching events with filter:`, {
    kinds: filter.kinds,
    authorsCount: filter.authors.length,
    until: new Date(filter.until * 1000).toISOString(),
    limit: filter.limit,
    relaysCount: relays.length,
  });

  const subscription = rxNostr.use(req, { relays }).subscribe({
    next: (packet: EventPacket) => {
      if (!routeIsActive()) {
        subscription.unsubscribe();
        return;
      }

      const event: NostrEvent = packet.event;
      console.log(
        `[HomeTimeline] Received event ${event.id} from ${packet.from} (kind ${event.kind})`,
      );
      if (seenEventIds.has(event.id)) return;
      seenEventIds.add(event.id);

      if (connectingMsg) {
        connectingMsg.style.display = 'none';
      }

      bufferedEvents.push(event);
      scheduleFlush();
    },
    error: (err) => {
      if (!routeIsActive()) return;
      console.error('[HomeTimeline] Subscription error:', err);
      if (connectingMsg) {
        connectingMsg.style.display = 'none';
      }
      if (loadMoreBtn) {
        (loadMoreBtn as HTMLButtonElement).disabled = false;
        loadMoreBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
      // Force finalization on error
      if (!finalized) {
        finalizeLoading();
      }
    },
    complete: () => {
      console.log(
        `[HomeTimeline] Subscription complete. Received ${bufferedEvents.length} events.`,
      );
      if (!finalized) {
        finalizeLoading();
      }
    },
  });

  // Emit filter AFTER subscribe — rx-nostr uses a regular Subject, not ReplaySubject,
  // so emissions before subscription are lost
  req.emit(filter);

  if (loadMoreBtn) {
    // Remove old listeners and add new one
    const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(
      true,
    ) as HTMLElement;
    loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
    newLoadMoreBtn.addEventListener(
      'click',
      (): Promise<void> =>
        loadHomeTimeline(
          followedPubkeys,
          kinds,
          [],
          limit,
          untilTimestamp,
          seenEventIds,
          output,
          connectingMsg,
          [],
          activeTimeouts,
          routeIsActive,
          userPubkey,
        ),
    );
  }
}
