import { countEvents, countProtectedEvents } from './events-store.js';
import {
  createTransaction,
  isIndexedDBAvailable,
  requestToPromise,
  transactionToPromise,
} from './indexeddb.js';
import { countProfiles } from './profiles-store.js';
import { countTimelines } from './timelines-store.js';
import {
  type CacheStats,
  type Metadata,
  STORE_NAMES,
  type SyncStatus,
} from './types.js';

/**
 * Sets a metadata value
 */
export async function setMetadata(key: string, value: unknown): Promise<void> {
  if (!isIndexedDBAvailable()) return;

  try {
    const tx = await createTransaction(STORE_NAMES.METADATA, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.METADATA);

    const metadata: Metadata = {
      key,
      value,
      updatedAt: Date.now(),
    };

    store.put(metadata);
    await transactionToPromise(tx);
  } catch (error) {
    console.error('[MetadataStore] Failed to set metadata:', error);
  }
}

/**
 * Gets a metadata value
 */
export async function getMetadata<T = unknown>(key: string): Promise<T | null> {
  if (!isIndexedDBAvailable()) return null;

  try {
    const tx = await createTransaction(STORE_NAMES.METADATA, 'readonly');
    const store = tx.objectStore(STORE_NAMES.METADATA);

    const metadata = await requestToPromise<Metadata | undefined>(
      store.get(key),
    );

    return metadata ? (metadata.value as T) : null;
  } catch (error) {
    console.error('[MetadataStore] Failed to get metadata:', error);
    return null;
  }
}

/**
 * Deletes a metadata value
 */
export async function deleteMetadata(key: string): Promise<void> {
  if (!isIndexedDBAvailable()) return;

  try {
    const tx = await createTransaction(STORE_NAMES.METADATA, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.METADATA);
    await requestToPromise(store.delete(key));
  } catch (error) {
    console.error('[MetadataStore] Failed to delete metadata:', error);
  }
}

/**
 * Gets sync status
 */
export async function getSyncStatus(): Promise<SyncStatus | null> {
  return getMetadata<SyncStatus>('syncStatus');
}

/**
 * Sets sync status
 */
export async function setSyncStatus(status: SyncStatus): Promise<void> {
  await setMetadata('syncStatus', status);
}

/**
 * Updates last sync timestamp
 */
export async function updateLastSync(): Promise<void> {
  const status = await getSyncStatus();
  if (status) {
    status.lastSync = Date.now();
    await setSyncStatus(status);
  } else {
    await setSyncStatus({
      lastSync: Date.now(),
      isOnline: navigator.onLine,
      activeTimelines: [],
    });
  }
}

/**
 * Gets cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  if (!isIndexedDBAvailable()) {
    return {
      events: { count: 0, bytes: 0, protected: 0 },
      profiles: { count: 0, bytes: 0 },
      timelines: { count: 0 },
      totalBytes: 0,
    };
  }

  try {
    const [eventCount, protectedCount, profileCount, timelineCount] =
      await Promise.all([
        countEvents(),
        countProtectedEvents(),
        countProfiles(),
        countTimelines(),
      ]);

    // Estimate bytes (rough approximation)
    // Average event: ~2KB, average profile: ~1KB
    const eventBytes = eventCount * 2048;
    const profileBytes = profileCount * 1024;

    return {
      events: {
        count: eventCount,
        bytes: eventBytes,
        protected: protectedCount,
      },
      profiles: {
        count: profileCount,
        bytes: profileBytes,
      },
      timelines: {
        count: timelineCount,
      },
      totalBytes: eventBytes + profileBytes,
    };
  } catch (error) {
    console.error('[MetadataStore] Failed to get cache stats:', error);
    return {
      events: { count: 0, bytes: 0, protected: 0 },
      profiles: { count: 0, bytes: 0 },
      timelines: { count: 0 },
      totalBytes: 0,
    };
  }
}

/**
 * Clears all metadata
 */
export async function clearMetadata(): Promise<void> {
  if (!isIndexedDBAvailable()) return;

  try {
    const tx = await createTransaction(STORE_NAMES.METADATA, 'readwrite');
    const store = tx.objectStore(STORE_NAMES.METADATA);
    await requestToPromise(store.clear());
    console.log('[MetadataStore] Cleared all metadata');
  } catch (error) {
    console.error('[MetadataStore] Failed to clear metadata:', error);
  }
}
