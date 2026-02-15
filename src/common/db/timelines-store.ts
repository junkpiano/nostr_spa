import type { PubkeyHex } from '../../../types/nostr.js';
import { isTimelineCacheEnabled } from '../cache-settings.js';
import {
  createTransaction,
  isIndexedDBAvailable,
  requestToPromise,
  transactionToPromise,
} from './indexeddb.js';
import {
  LIMITS,
  STORE_NAMES,
  type Timeline,
  type TimelineType,
} from './types.js';

/**
 * Generates a timeline key from type and optional pubkey
 */
export function getTimelineKey(type: TimelineType, pubkey?: PubkeyHex): string {
  switch (type) {
    case 'home':
      return `home:${pubkey}`;
    case 'global':
      return 'global';
    case 'user':
      return `user:${pubkey}`;
  }
}

/**
 * Stores or updates a timeline
 */
export async function storeTimeline(timeline: Timeline): Promise<void> {
  if (!isIndexedDBAvailable() || !isTimelineCacheEnabled()) return;

  try {
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);

    timeline.updatedAt = Date.now();
    store.put(timeline);

    await transactionToPromise(tx);
  } catch (error) {
    console.error('[TimelinesStore] Failed to store timeline:', error);
  }
}

/**
 * Retrieves a timeline by key
 */
export async function getTimeline(
  type: TimelineType,
  pubkey?: PubkeyHex,
): Promise<Timeline | null> {
  if (!isIndexedDBAvailable() || !isTimelineCacheEnabled()) return null;

  try {
    const key = getTimelineKey(type, pubkey);
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readonly');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);

    const timeline = await requestToPromise<Timeline | undefined>(
      store.get(key),
    );

    return timeline || null;
  } catch (error) {
    console.error('[TimelinesStore] Failed to get timeline:', error);
    return null;
  }
}

/**
 * Updates a timeline with new event IDs (prepends to the list)
 */
export async function prependEventsToTimeline(
  type: TimelineType,
  pubkey: PubkeyHex | undefined,
  eventIds: string[],
  newestTimestamp: number,
): Promise<void> {
  if (
    !isIndexedDBAvailable() ||
    !isTimelineCacheEnabled() ||
    eventIds.length === 0
  )
    return;

  try {
    const key = getTimelineKey(type, pubkey);
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);

    const existing = await requestToPromise<Timeline | undefined>(
      store.get(key),
    );

    if (existing) {
      // Prepend new events (remove duplicates)
      const existingSet = new Set(existing.eventIds);
      const newEventIds = eventIds.filter((id) => !existingSet.has(id));
      existing.eventIds = [...newEventIds, ...existing.eventIds];
      existing.newestTimestamp = Math.max(
        existing.newestTimestamp,
        newestTimestamp,
      );
      existing.updatedAt = Date.now();
      store.put(existing);
    } else {
      // Create new timeline
      const timeline: Timeline = {
        key,
        type,
        pubkey,
        eventIds,
        newestTimestamp,
        oldestTimestamp: newestTimestamp,
        updatedAt: Date.now(),
      };
      store.put(timeline);
    }

    await transactionToPromise(tx);
  } catch (error) {
    console.error(
      '[TimelinesStore] Failed to prepend events to timeline:',
      error,
    );
  }
}

/**
 * Updates a timeline with older event IDs (appends to the list)
 */
export async function appendEventsToTimeline(
  type: TimelineType,
  pubkey: PubkeyHex | undefined,
  eventIds: string[],
  oldestTimestamp: number,
): Promise<void> {
  if (
    !isIndexedDBAvailable() ||
    !isTimelineCacheEnabled() ||
    eventIds.length === 0
  )
    return;

  try {
    const key = getTimelineKey(type, pubkey);
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);

    const existing = await requestToPromise<Timeline | undefined>(
      store.get(key),
    );

    if (existing) {
      // Append older events (remove duplicates)
      const existingSet = new Set(existing.eventIds);
      const newEventIds = eventIds.filter((id) => !existingSet.has(id));
      existing.eventIds = [...existing.eventIds, ...newEventIds];
      existing.oldestTimestamp = Math.min(
        existing.oldestTimestamp,
        oldestTimestamp,
      );
      existing.updatedAt = Date.now();
      store.put(existing);
    } else {
      // Create new timeline
      const timeline: Timeline = {
        key,
        type,
        pubkey,
        eventIds,
        newestTimestamp: oldestTimestamp,
        oldestTimestamp,
        updatedAt: Date.now(),
      };
      store.put(timeline);
    }

    await transactionToPromise(tx);
  } catch (error) {
    console.error(
      '[TimelinesStore] Failed to append events to timeline:',
      error,
    );
  }
}

/**
 * Removes an event ID from a timeline (e.g., when deleted)
 */
export async function removeEventFromTimeline(
  type: TimelineType,
  pubkey: PubkeyHex | undefined,
  eventId: string,
): Promise<void> {
  if (!isIndexedDBAvailable() || !isTimelineCacheEnabled()) return;

  try {
    const key = getTimelineKey(type, pubkey);
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);

    const existing = await requestToPromise<Timeline | undefined>(
      store.get(key),
    );

    if (existing) {
      existing.eventIds = existing.eventIds.filter((id) => id !== eventId);
      existing.updatedAt = Date.now();
      store.put(existing);
    }

    await transactionToPromise(tx);
  } catch (error) {
    console.error(
      '[TimelinesStore] Failed to remove event from timeline:',
      error,
    );
  }
}

/**
 * Retrieves all timelines
 */
export async function getAllTimelines(): Promise<Timeline[]> {
  if (!isIndexedDBAvailable() || !isTimelineCacheEnabled()) return [];

  try {
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readonly');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);

    return new Promise<Timeline[]>((resolve, reject) => {
      const timelines: Timeline[] = [];
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = (): void => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve(timelines);
          return;
        }

        timelines.push(cursor.value as Timeline);
        cursor.continue();
      };

      cursorRequest.onerror = (): void => reject(cursorRequest.error);
    });
  } catch (error) {
    console.error('[TimelinesStore] Failed to get all timelines:', error);
    return [];
  }
}

/**
 * Counts total timelines in the store
 */
export async function countTimelines(): Promise<number> {
  if (!isIndexedDBAvailable() || !isTimelineCacheEnabled()) return 0;

  try {
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readonly');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);
    return await requestToPromise<number>(store.count());
  } catch (error) {
    console.error('[TimelinesStore] Failed to count timelines:', error);
    return 0;
  }
}

/**
 * Prunes old timelines when limit is exceeded (keeps most recent)
 */
export async function pruneTimelines(): Promise<number> {
  if (!isIndexedDBAvailable() || !isTimelineCacheEnabled()) return 0;

  try {
    const count = await countTimelines();
    if (count <= LIMITS.TIMELINES) {
      return 0; // No pruning needed
    }

    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);
    const index = store.index('updatedAt');

    const toDelete = count - LIMITS.TIMELINES;
    let deleted = 0;

    return new Promise<number>((resolve, reject) => {
      const cursorRequest = index.openCursor(); // Oldest updated first

      cursorRequest.onsuccess = (): void => {
        const cursor = cursorRequest.result;
        if (!cursor || deleted >= toDelete) {
          console.log(`[TimelinesStore] Pruned ${deleted} timelines`);
          resolve(deleted);
          return;
        }

        const timeline = cursor.value as Timeline;

        // Don't delete current user's home timeline or global timeline
        if (timeline.type !== 'home' && timeline.type !== 'global') {
          cursor.delete();
          deleted++;
        }

        cursor.continue();
      };

      cursorRequest.onerror = (): void => reject(cursorRequest.error);
    });
  } catch (error) {
    console.error('[TimelinesStore] Failed to prune timelines:', error);
    return 0;
  }
}

/**
 * Clears all timelines from the store
 */
export async function clearTimelines(): Promise<void> {
  if (!isIndexedDBAvailable()) return;

  try {
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);
    await requestToPromise(store.clear());
    console.log('[TimelinesStore] Cleared all timelines');
  } catch (error) {
    console.error('[TimelinesStore] Failed to clear timelines:', error);
  }
}

/**
 * Deletes a specific timeline
 */
export async function deleteTimeline(
  type: TimelineType,
  pubkey?: PubkeyHex,
): Promise<void> {
  if (!isIndexedDBAvailable()) return;

  try {
    const key = getTimelineKey(type, pubkey);
    const tx = await createTransaction(STORE_NAMES.TIMELINES, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.TIMELINES);
    await requestToPromise(store.delete(key));
    console.log(`[TimelinesStore] Deleted timeline: ${key}`);
  } catch (error) {
    console.error('[TimelinesStore] Failed to delete timeline:', error);
  }
}
