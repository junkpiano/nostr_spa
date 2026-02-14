import type { NostrEvent } from '../../../types/nostr.js';
import { storeEvents as batchStoreEvents } from './events-store.js';

interface QueuedEvent {
  event: NostrEvent;
  isHomeTimeline: boolean;
}

class EventWriter {
  private queue: QueuedEvent[] = [];
  private flushTimeoutId: number | null = null;
  private readonly flushDelayMs = 500; // Debounce delay
  private readonly maxBatchSize = 100;
  private isProcessing = false;

  /**
   * Adds an event to the write queue
   */
  public queueEvent(event: NostrEvent, isHomeTimeline = false): void {
    this.queue.push({ event, isHomeTimeline });

    // If batch size exceeded, flush immediately
    if (this.queue.length >= this.maxBatchSize) {
      this.flushNow();
    } else {
      this.scheduleFlush();
    }
  }

  /**
   * Adds multiple events to the write queue
   */
  public queueEvents(events: NostrEvent[], isHomeTimeline = false): void {
    for (const event of events) {
      this.queue.push({ event, isHomeTimeline });
    }

    if (this.queue.length >= this.maxBatchSize) {
      this.flushNow();
    } else {
      this.scheduleFlush();
    }
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
   * Immediately flushes all queued events to IndexedDB
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
    const batch = this.queue.splice(0); // Take all queued events

    try {
      // Group by isHomeTimeline flag
      const homeEvents = batch
        .filter((item) => item.isHomeTimeline)
        .map((item) => item.event);
      const regularEvents = batch
        .filter((item) => !item.isHomeTimeline)
        .map((item) => item.event);

      // Store in batches
      if (homeEvents.length > 0) {
        await batchStoreEvents(homeEvents, { isHomeTimeline: true });
        console.log(`[EventWriter] Stored ${homeEvents.length} home events`);
      }

      if (regularEvents.length > 0) {
        await batchStoreEvents(regularEvents, { isHomeTimeline: false });
        console.log(`[EventWriter] Stored ${regularEvents.length} events`);
      }
    } catch (error) {
      console.error('[EventWriter] Failed to flush events:', error);
      // Don't re-queue failed events to avoid infinite loops
    } finally {
      this.isProcessing = false;

      // If more events were queued during processing, schedule another flush
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * Returns the number of queued events
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
export const eventWriter = new EventWriter();

/**
 * Convenience function to queue a single event
 */
export function writeEvent(event: NostrEvent, isHomeTimeline = false): void {
  eventWriter.queueEvent(event, isHomeTimeline);
}

/**
 * Convenience function to queue multiple events
 */
export function writeEvents(
  events: NostrEvent[],
  isHomeTimeline = false,
): void {
  eventWriter.queueEvents(events, isHomeTimeline);
}

/**
 * Convenience function to flush immediately
 */
export function flushEvents(): Promise<void> {
  return eventWriter.flushNow();
}
