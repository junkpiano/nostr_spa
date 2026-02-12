import type { PubkeyHex } from "../../../types/nostr.js";
import type { TimelineType } from "./types.js";
import {
  prependEventsToTimeline as dbPrependEvents,
  appendEventsToTimeline as dbAppendEvents,
} from "./timelines-store.js";

interface TimelineUpdate {
  type: TimelineType;
  pubkey?: PubkeyHex | undefined;
  eventIds: string[];
  timestamp: number;
  isPrepend: boolean; // true = prepend (newer), false = append (older)
}

class TimelineBuilder {
  private queue: TimelineUpdate[] = [];
  private flushTimeoutId: number | null = null;
  private readonly flushDelayMs = 500;
  private isProcessing = false;

  /**
   * Queues events to be prepended to a timeline (newer events)
   */
  public queuePrepend(
    type: TimelineType,
    eventIds: string[],
    newestTimestamp: number,
    pubkey?: PubkeyHex | undefined
  ): void {
    this.queue.push({
      type,
      pubkey,
      eventIds,
      timestamp: newestTimestamp,
      isPrepend: true,
    });

    this.scheduleFlush();
  }

  /**
   * Queues events to be appended to a timeline (older events)
   */
  public queueAppend(
    type: TimelineType,
    eventIds: string[],
    oldestTimestamp: number,
    pubkey?: PubkeyHex | undefined
  ): void {
    this.queue.push({
      type,
      pubkey,
      eventIds,
      timestamp: oldestTimestamp,
      isPrepend: false,
    });

    this.scheduleFlush();
  }

  /**
   * Schedules a flush after the debounce delay
   */
  private scheduleFlush(): void {
    if (this.flushTimeoutId !== null) {
      window.clearTimeout(this.flushTimeoutId);
    }

    this.flushTimeoutId = window.setTimeout(() => {
      this.flushNow();
    }, this.flushDelayMs);
  }

  /**
   * Immediately flushes all queued timeline updates
   */
  public async flushNow(): Promise<void> {
    if (this.flushTimeoutId !== null) {
      window.clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    if (this.queue.length === 0 || this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const updates = this.queue.splice(0);

    try {
      // Group updates by timeline key and type (prepend/append)
      const grouped = new Map<
        string,
        { prepend: TimelineUpdate[]; append: TimelineUpdate[] }
      >();

      for (const update of updates) {
        const key = `${update.type}:${update.pubkey || ""}`;
        if (!grouped.has(key)) {
          grouped.set(key, { prepend: [], append: [] });
        }

        const group = grouped.get(key)!;
        if (update.isPrepend) {
          group.prepend.push(update);
        } else {
          group.append.push(update);
        }
      }

      // Process each timeline
      for (const [key, { prepend, append }] of grouped) {
        const [type, pubkeyStr] = key.split(":");
        const pubkey = pubkeyStr || undefined;

        // Process prepends (newer events)
        if (prepend.length > 0) {
          const allEventIds = prepend.flatMap((u) => u.eventIds);
          const newestTimestamp = Math.max(...prepend.map((u) => u.timestamp));

          await dbPrependEvents(
            type as TimelineType,
            pubkey as PubkeyHex | undefined,
            allEventIds,
            newestTimestamp
          );

          console.log(
            `[TimelineBuilder] Prepended ${allEventIds.length} events to ${type} timeline`
          );
        }

        // Process appends (older events)
        if (append.length > 0) {
          const allEventIds = append.flatMap((u) => u.eventIds);
          const oldestTimestamp = Math.min(...append.map((u) => u.timestamp));

          await dbAppendEvents(
            type as TimelineType,
            pubkey as PubkeyHex | undefined,
            allEventIds,
            oldestTimestamp
          );

          console.log(
            `[TimelineBuilder] Appended ${allEventIds.length} events to ${type} timeline`
          );
        }
      }
    } catch (error) {
      console.error("[TimelineBuilder] Failed to flush timeline updates:", error);
    } finally {
      this.isProcessing = false;

      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * Returns the number of queued updates
   */
  public getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Clears the queue without writing
   */
  public clearQueue(): void {
    this.queue = [];
    if (this.flushTimeoutId !== null) {
      window.clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }
  }
}

// Singleton instance
export const timelineBuilder = new TimelineBuilder();

/**
 * Convenience function to prepend events to a timeline
 */
export function prependToTimeline(
  type: TimelineType,
  eventIds: string[],
  newestTimestamp: number,
  pubkey?: PubkeyHex | undefined
): void {
  timelineBuilder.queuePrepend(type, eventIds, newestTimestamp, pubkey);
}

/**
 * Convenience function to append events to a timeline
 */
export function appendToTimeline(
  type: TimelineType,
  eventIds: string[],
  oldestTimestamp: number,
  pubkey?: PubkeyHex | undefined
): void {
  timelineBuilder.queueAppend(type, eventIds, oldestTimestamp, pubkey);
}

/**
 * Convenience function to flush immediately
 */
export function flushTimelines(): Promise<void> {
  return timelineBuilder.flushNow();
}
