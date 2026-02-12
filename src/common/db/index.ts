// Core database
export {
  openDb,
  closeDb,
  createTransaction,
  requestToPromise,
  transactionToPromise,
  deleteDatabase,
  isIndexedDBAvailable,
} from "./indexeddb.js";

// Types and constants
export type {
  CachedEvent,
  CachedProfile,
  Timeline,
  TimelineType,
  TimelineKey,
  Metadata,
  CacheStats,
  SyncStatus,
  EventQueryOptions,
  TransactionMode,
  StoreName,
} from "./types.js";

export {
  DB_NAME,
  DB_VERSION,
  STORE_NAMES,
  LIMITS,
  TTL,
} from "./types.js";

// Events store
export {
  storeEvent,
  storeEvents,
  getEvent,
  getEvents,
  queryEvents,
  countEvents,
  pruneEvents,
  clearEvents,
  deleteEvents,
  getEventsByAuthor,
} from "./events-store.js";

// Profiles store
export {
  storeProfile,
  storeProfiles,
  getProfile,
  getProfiles,
  profileNeedsRefresh,
  countProfiles,
  pruneProfiles,
  clearProfiles,
  deleteProfiles,
} from "./profiles-store.js";

// Timelines store
export {
  getTimelineKey,
  storeTimeline,
  getTimeline,
  prependEventsToTimeline,
  appendEventsToTimeline,
  removeEventFromTimeline,
  getAllTimelines,
  countTimelines,
  pruneTimelines,
  clearTimelines,
  deleteTimeline,
} from "./timelines-store.js";

// Metadata store
export {
  setMetadata,
  getMetadata,
  deleteMetadata,
  getSyncStatus,
  setSyncStatus,
  updateLastSync,
  getCacheStats,
  clearMetadata,
} from "./metadata-store.js";

// Timeline queries
export type { CachedTimelineResult } from "./timeline-queries.js";
export {
  getCachedTimeline,
  getTimelineNewestTimestamp,
  getTimelineOldestTimestamp,
  hasTimelineCache,
  getTimelineCacheSize,
} from "./timeline-queries.js";

// Event writer (batched writes with debouncing)
export {
  eventWriter,
  writeEvent,
  writeEvents,
  flushEvents,
} from "./event-writer.js";

// Timeline builder (batched timeline updates)
export {
  timelineBuilder,
  prependToTimeline,
  appendToTimeline,
  flushTimelines,
} from "./timeline-builder.js";
