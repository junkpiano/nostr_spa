import type { NostrEvent, PubkeyHex } from '../../../types/nostr.js';
import { getRelays } from '../../features/relays/relays.js';
import { storeEvents } from '../db/events-store.js';
import {
  getTimelineNewestTimestamp,
  hasTimelineCache,
} from '../db/timeline-queries.js';
import { prependEventsToTimeline } from '../db/timelines-store.js';
import type { TimelineType } from '../db/types.js';
import { createRelayWebSocket } from '../relay-socket.js';

export interface SyncResult {
  newEventCount: number;
  success: boolean;
  error?: string;
}

export interface SyncOptions {
  timeoutMs?: number;
  limit?: number;
}

/**
 * Syncs a timeline by fetching new events from relays
 * and storing them in IndexedDB
 */
export async function syncTimeline(
  type: TimelineType,
  pubkey: PubkeyHex | undefined,
  followedPubkeys?: PubkeyHex[],
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { timeoutMs = 10000, limit = 100 } = options;

  try {
    // Check if timeline has cache
    const hasCache = await hasTimelineCache(type, pubkey);
    if (!hasCache) {
      console.log(`[SyncManager] No cache for ${type} timeline, skipping sync`);
      return { newEventCount: 0, success: true };
    }

    // Get the newest timestamp from cached timeline
    const newestTimestamp = await getTimelineNewestTimestamp(type, pubkey);
    const sinceTimestamp =
      newestTimestamp > 0
        ? newestTimestamp
        : Math.floor(Date.now() / 1000) - 3600; // Last hour as fallback

    console.log(
      `[SyncManager] Syncing ${type} timeline since ${new Date(sinceTimestamp * 1000).toISOString()}`,
    );

    // Fetch new events from relays
    const relays = getRelays();
    const newEvents = await fetchNewEvents(
      type,
      relays,
      sinceTimestamp,
      limit,
      followedPubkeys,
    );

    if (newEvents.length === 0) {
      console.log(`[SyncManager] No new events found for ${type} timeline`);
      return { newEventCount: 0, success: true };
    }

    // Store events in IndexedDB
    await storeEvents(newEvents, { isHomeTimeline: type === 'home' });

    // Update timeline index
    const eventIds = newEvents.map((e) => e.id);
    const timestamps = newEvents.map((e) => e.created_at);
    const maxTimestamp = Math.max(...timestamps);

    await prependEventsToTimeline(type, pubkey, eventIds, maxTimestamp);

    console.log(
      `[SyncManager] Synced ${newEvents.length} new events for ${type} timeline`,
    );

    return {
      newEventCount: newEvents.length,
      success: true,
    };
  } catch (error) {
    console.error(`[SyncManager] Failed to sync ${type} timeline:`, error);
    return {
      newEventCount: 0,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fetches new events from relays
 */
async function fetchNewEvents(
  type: TimelineType,
  relays: string[],
  sinceTimestamp: number,
  limit: number,
  followedPubkeys?: PubkeyHex[],
): Promise<NostrEvent[]> {
  const seenEventIds = new Set<string>();
  const events: NostrEvent[] = [];

  // Build filter based on timeline type
  const filter: any = {
    kinds: [1],
    limit,
    since: sinceTimestamp,
  };

  if (type === 'home' && followedPubkeys && followedPubkeys.length > 0) {
    filter.authors = followedPubkeys;
  }

  // Query all relays in parallel
  const promises = relays.map(async (relayUrl: string): Promise<void> => {
    try {
      const socket = createRelayWebSocket(relayUrl, false); // Don't track health for background sync

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.close();
          resolve();
        };

        const timeout = setTimeout(finish, 10000);

        socket.onopen = (): void => {
          const subId = `sync-${Math.random().toString(36).slice(2)}`;
          const req = ['REQ', subId, filter];
          socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          try {
            const arr = JSON.parse(msg.data);
            if (arr[0] === 'EVENT' && arr[2]?.kind === 1) {
              const event: NostrEvent = arr[2];
              if (!seenEventIds.has(event.id)) {
                seenEventIds.add(event.id);
                events.push(event);
              }
            } else if (arr[0] === 'EOSE') {
              finish();
            }
          } catch (e) {
            console.warn(
              `[SyncManager] Failed to parse message from ${relayUrl}:`,
              e,
            );
          }
        };

        socket.onerror = (): void => {
          finish();
        };

        socket.onclose = (): void => {
          finish();
        };
      });
    } catch (e) {
      console.warn(`[SyncManager] Failed to fetch from ${relayUrl}:`, e);
    }
  });

  await Promise.allSettled(promises);

  // Sort by timestamp (newest first)
  events.sort((a, b) => b.created_at - a.created_at);

  return events;
}

/**
 * Syncs home timeline for a specific user
 */
export async function syncHomeTimeline(
  userPubkey: PubkeyHex,
  followedPubkeys: PubkeyHex[],
  options?: SyncOptions,
): Promise<SyncResult> {
  return syncTimeline('home', userPubkey, followedPubkeys, options);
}

/**
 * Syncs global timeline
 */
export async function syncGlobalTimeline(
  options?: SyncOptions,
): Promise<SyncResult> {
  return syncTimeline('global', undefined, undefined, options);
}

/**
 * Syncs user timeline for a specific pubkey
 */
export async function syncUserTimeline(
  pubkey: PubkeyHex,
  options?: SyncOptions,
): Promise<SyncResult> {
  return syncTimeline('user', pubkey, [pubkey], options);
}
