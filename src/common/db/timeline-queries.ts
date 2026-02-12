import type { NostrEvent, PubkeyHex } from "../../../types/nostr.js";
import { getTimeline } from "./timelines-store.js";
import { getEvents } from "./events-store.js";
import type { TimelineType } from "./types.js";

/**
 * Result from loading a cached timeline
 */
export interface CachedTimelineResult {
  events: NostrEvent[];
  newestTimestamp: number;
  oldestTimestamp: number;
  hasCache: boolean;
}

/**
 * Loads events from a cached timeline
 */
export async function getCachedTimeline(
  type: TimelineType,
  pubkey?: PubkeyHex | undefined,
  options?: {
    limit?: number | undefined;
    offset?: number | undefined;
  } | undefined
): Promise<CachedTimelineResult> {
  const timeline = await getTimeline(type, pubkey);

  if (!timeline || timeline.eventIds.length === 0) {
    return {
      events: [],
      newestTimestamp: 0,
      oldestTimestamp: 0,
      hasCache: false,
    };
  }

  // Apply pagination
  const limit = options?.limit ?? timeline.eventIds.length;
  const offset = options?.offset ?? 0;
  const eventIds = timeline.eventIds.slice(offset, offset + limit);

  // Fetch events from events store
  const events = await getEvents(eventIds);

  // Maintain order from timeline (eventIds are already sorted newest first)
  const eventMap = new Map(events.map((e) => [e.id, e]));
  const orderedEvents = eventIds
    .map((id) => eventMap.get(id))
    .filter((e): e is NostrEvent => e !== undefined);

  return {
    events: orderedEvents,
    newestTimestamp: timeline.newestTimestamp,
    oldestTimestamp: timeline.oldestTimestamp,
    hasCache: true,
  };
}

/**
 * Gets the newest timestamp from a cached timeline (for incremental sync)
 */
export async function getTimelineNewestTimestamp(
  type: TimelineType,
  pubkey?: PubkeyHex
): Promise<number> {
  const timeline = await getTimeline(type, pubkey);
  return timeline?.newestTimestamp ?? 0;
}

/**
 * Gets the oldest timestamp from a cached timeline (for pagination)
 */
export async function getTimelineOldestTimestamp(
  type: TimelineType,
  pubkey?: PubkeyHex
): Promise<number> {
  const timeline = await getTimeline(type, pubkey);
  return timeline?.oldestTimestamp ?? Date.now();
}

/**
 * Checks if a timeline has cached data
 */
export async function hasTimelineCache(
  type: TimelineType,
  pubkey?: PubkeyHex
): Promise<boolean> {
  const timeline = await getTimeline(type, pubkey);
  return timeline !== null && timeline.eventIds.length > 0;
}

/**
 * Gets the count of cached events in a timeline
 */
export async function getTimelineCacheSize(
  type: TimelineType,
  pubkey?: PubkeyHex
): Promise<number> {
  const timeline = await getTimeline(type, pubkey);
  return timeline?.eventIds.length ?? 0;
}
