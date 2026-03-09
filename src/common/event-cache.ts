import type { NostrEvent } from '../../types/nostr';
import { isTimelineCacheEnabled } from './cache-settings.js';
import {
  clearEvents,
  getCacheStats,
  getEvent,
  LIMITS,
  storeEvent,
} from './db/index.js';

// Compatibility wrapper: event lookups now use the main IndexedDB cache.
export const EVENT_CACHE_LIMIT: number = LIMITS.EVENTS_HARD;

export async function getEventCacheStats(): Promise<{
  count: number;
  bytes: number;
}> {
  const stats = await getCacheStats();
  return {
    count: stats.events.count,
    bytes: stats.events.bytes,
  };
}

export async function clearEventCache(): Promise<void> {
  await clearEvents();
}

export async function getCachedEvent(
  eventId: string,
): Promise<NostrEvent | null> {
  if (!isTimelineCacheEnabled()) {
    return null;
  }
  return await getEvent(eventId);
}

export async function setCachedEvent(event: NostrEvent): Promise<void> {
  if (!isTimelineCacheEnabled()) {
    return;
  }
  await storeEvent(event);
}
