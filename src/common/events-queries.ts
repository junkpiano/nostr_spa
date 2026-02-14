import type { NostrEvent, PubkeyHex } from '../../types/nostr';
import { recordRelayFailure } from '../features/relays/relays.js';
import { createRelayWebSocket } from './relay-socket.js';

const deletionCache: Map<string, boolean> = new Map();

export function getCachedDeletionStatus(eventId: string): boolean | undefined {
  return deletionCache.get(eventId);
}

export function cacheDeletionStatus(eventId: string, deleted: boolean): void {
  deletionCache.set(eventId, deleted);
}

export async function fetchFollowList(
  pubkeyHex: PubkeyHex,
  relays: string[],
): Promise<PubkeyHex[]> {
  console.log(`Fetching follow list for ${pubkeyHex}`);
  let latestFollowTimestamp: number = -1;
  let latestFollowTags: string[][] = [];

  const relayResults: Map<
    string,
    { gotEvent: boolean; tagCount: number; createdAt: number | null }
  > = new Map();

  const promises = relays.map(async (relayUrl: string): Promise<void> => {
    try {
      const socket: WebSocket = createRelayWebSocket(relayUrl);
      await new Promise<void>((resolve) => {
        let settled: boolean = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.close();
          resolve();
        };

        const timeout = setTimeout(() => {
          recordRelayFailure(relayUrl);
          finish();
        }, 5000);

        socket.onopen = (): void => {
          const subId: string = `follows-${Math.random().toString(36).slice(2)}`;
          const req: [
            string,
            string,
            { kinds: number[]; authors: string[]; limit: number },
          ] = ['REQ', subId, { kinds: [3], authors: [pubkeyHex], limit: 20 }];
          console.log(`Requesting follows from ${relayUrl}`);
          socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === 'EVENT' && arr[2]?.kind === 3) {
            const event: NostrEvent = arr[2];
            if (event.created_at >= latestFollowTimestamp) {
              latestFollowTimestamp = event.created_at;
              latestFollowTags = event.tags;
            }
            relayResults.set(relayUrl, {
              gotEvent: true,
              tagCount: event.tags.length,
              createdAt: event.created_at,
            });
            console.log(
              `Got kind 3 event from ${relayUrl} with ${event.tags.length} tags at ${event.created_at}`,
            );
          } else if (arr[0] === 'EOSE') {
            if (!relayResults.has(relayUrl)) {
              relayResults.set(relayUrl, {
                gotEvent: false,
                tagCount: 0,
                createdAt: null,
              });
            }
            finish();
          }
        };

        socket.onerror = (err: Event): void => {
          console.error(`WebSocket error [${relayUrl}]`, err);
          finish();
        };
      });
    } catch (e) {
      console.warn(`Failed to fetch follows from ${relayUrl}:`, e);
    }
  });

  await Promise.allSettled(promises);

  const followedPubkeys: Set<PubkeyHex> = new Set();
  latestFollowTags.forEach((tag: string[]): void => {
    if (tag[0] === 'p' && tag[1]) {
      followedPubkeys.add(tag[1] as PubkeyHex);
    }
  });

  console.log(`Follow list relay summary:`, Array.from(relayResults.entries()));
  console.log(
    `Using latest kind 3 event at ${latestFollowTimestamp >= 0 ? latestFollowTimestamp : 'n/a'}, total follows: ${followedPubkeys.size}`,
  );
  return Array.from(followedPubkeys);
}

async function fetchEventFromRelay(
  eventId: string,
  relayUrl: string,
  timeoutMs: number,
): Promise<NostrEvent | null> {
  return await new Promise<NostrEvent | null>((resolve) => {
    let settled: boolean = false;
    const socket: WebSocket = createRelayWebSocket(relayUrl);

    const finish = (event: NostrEvent | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve(event);
    };

    const timeout = setTimeout((): void => {
      recordRelayFailure(relayUrl);
      finish(null);
    }, timeoutMs);

    socket.onopen = (): void => {
      const subId: string = `event-${Math.random().toString(36).slice(2)}`;
      const req: [string, string, { ids: string[]; limit: number }] = [
        'REQ',
        subId,
        { ids: [eventId], limit: 1 },
      ];
      socket.send(JSON.stringify(req));
    };

    socket.onmessage = (msg: MessageEvent): void => {
      const arr: any[] = JSON.parse(msg.data);
      if (arr[0] === 'EVENT' && arr[2]) {
        finish(arr[2] as NostrEvent);
        return;
      }
      if (arr[0] === 'EOSE') {
        finish(null);
      }
    };

    socket.onerror = (): void => {
      finish(null);
    };
  });
}

export async function fetchEventById(
  eventId: string,
  relays: string[],
): Promise<NostrEvent | null> {
  if (relays.length === 0) {
    return null;
  }

  for (const relayUrl of relays) {
    try {
      const event: NostrEvent | null = await fetchEventFromRelay(
        eventId,
        relayUrl,
        5000,
      );
      if (event) {
        return event;
      }
    } catch (e) {
      console.warn(`Failed to fetch event ${eventId} from ${relayUrl}:`, e);
    }
  }
  return null;
}

export async function isEventDeleted(
  eventId: string,
  authorPubkey: PubkeyHex,
  relays: string[],
): Promise<boolean> {
  if (relays.length === 0) {
    return false;
  }

  const perRelayTimeoutMs: number = 3000;
  const overallTimeoutMs: number = 3000;

  const checks: Promise<boolean>[] = relays.map(
    async (relayUrl: string): Promise<boolean> => {
      try {
        return await new Promise<boolean>((resolve) => {
          let settled: boolean = false;
          const socket: WebSocket = createRelayWebSocket(relayUrl);

          const finish = (value: boolean): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.close();
            resolve(value);
          };

          const timeout = setTimeout((): void => {
            recordRelayFailure(relayUrl);
            finish(false);
          }, perRelayTimeoutMs);

          socket.onopen = (): void => {
            const subId: string = `deleted-${Math.random().toString(36).slice(2)}`;
            const req: [
              string,
              string,
              {
                kinds: number[];
                authors: string[];
                '#e': string[];
                limit: number;
              },
            ] = [
              'REQ',
              subId,
              {
                kinds: [5],
                authors: [authorPubkey],
                '#e': [eventId],
                limit: 20,
              },
            ];
            socket.send(JSON.stringify(req));
          };

          socket.onmessage = (msg: MessageEvent): void => {
            const arr: any[] = JSON.parse(msg.data);
            if (arr[0] === 'EVENT' && arr[2]?.kind === 5) {
              const deleteEvent: NostrEvent = arr[2];
              const referencesTarget: boolean = deleteEvent.tags.some(
                (tag: string[]): boolean =>
                  tag[0] === 'e' && tag[1] === eventId,
              );
              if (referencesTarget) {
                finish(true);
                return;
              }
            } else if (arr[0] === 'EOSE') {
              finish(false);
            }
          };

          socket.onerror = (): void => {
            finish(false);
          };
        });
      } catch (e) {
        console.warn(`Failed to check delete event on ${relayUrl}:`, e);
        return false;
      }
    },
  );

  return await new Promise<boolean>((resolve) => {
    let settled: boolean = false;
    let pending: number = checks.length;

    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimeout);
      resolve(value);
    };

    const overallTimeout = setTimeout((): void => {
      finish(false);
    }, overallTimeoutMs);

    if (pending === 0) {
      finish(false);
      return;
    }

    checks.forEach((check: Promise<boolean>): void => {
      check
        .then((deleted: boolean): void => {
          if (deleted) {
            finish(true);
            return;
          }
          pending -= 1;
          if (pending <= 0) {
            finish(false);
          }
        })
        .catch((): void => {
          pending -= 1;
          if (pending <= 0) {
            finish(false);
          }
        });
    });
  });
}

export async function fetchRepliesForEvent(
  eventId: string,
  relays: string[],
): Promise<NostrEvent[]> {
  if (relays.length === 0) {
    return [];
  }

  const results: Map<string, NostrEvent> = new Map();

  const promises = relays.map(async (relayUrl: string): Promise<void> => {
    try {
      const socket: WebSocket = createRelayWebSocket(relayUrl);
      await new Promise<void>((resolve) => {
        let settled: boolean = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.close();
          resolve();
        };

        const timeout = setTimeout(() => {
          recordRelayFailure(relayUrl);
          finish();
        }, 5000);

        socket.onopen = (): void => {
          const subId: string = `replies-${Math.random().toString(36).slice(2)}`;
          const req: [
            string,
            string,
            { kinds: number[]; '#e': string[]; limit: number },
          ] = ['REQ', subId, { kinds: [1], '#e': [eventId], limit: 200 }];
          socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === 'EVENT' && arr[2]) {
            const event: NostrEvent = arr[2];
            results.set(event.id, event);
          } else if (arr[0] === 'EOSE') {
            finish();
          }
        };

        socket.onerror = (): void => {
          finish();
        };
      });
    } catch (e) {
      console.warn(`Failed to fetch replies from ${relayUrl}:`, e);
    }
  });

  await Promise.allSettled(promises);

  const events: NostrEvent[] = Array.from(results.values());
  events.sort(
    (a: NostrEvent, b: NostrEvent): number => a.created_at - b.created_at,
  );
  return events;
}
