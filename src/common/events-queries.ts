import { verifyEvent } from 'nostr-tools';
import type { NostrEvent, PubkeyHex } from '../../types/nostr';
import { recordRelayFailure } from '../features/relays/relays.js';
import { promiseAny, RelayMissError } from './promise-utils.js';
import { openRelaySubscription } from './relay-socket.js';

const deletionCache: Map<string, boolean> = new Map();
const FOLLOW_LIST_MAX_FUTURE_SKEW_SECONDS: number = 5 * 60;

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
      await new Promise<void>((resolve) => {
        let settled: boolean = false;
        let unsubscribe: (() => void) | null = null;

        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          unsubscribe?.();
          resolve();
        };

        const timeout = setTimeout(() => {
          recordRelayFailure(relayUrl);
          finish();
        }, 5000);

        console.log(`Requesting follows from ${relayUrl}`);
        void openRelaySubscription(
          relayUrl,
          { kinds: [3], authors: [pubkeyHex], limit: 50 },
          {
            onEvent: (event: NostrEvent): void => {
              if (event.kind !== 3 || event.pubkey !== pubkeyHex) {
                return;
              }

              if (!verifyEvent(event)) {
                console.warn(
                  `Ignoring invalid follow-list signature from ${relayUrl}`,
                );
                return;
              }

              const nowSeconds: number = Math.floor(Date.now() / 1000);
              if (
                event.created_at >
                nowSeconds + FOLLOW_LIST_MAX_FUTURE_SKEW_SECONDS
              ) {
                console.warn(
                  `Ignoring future-skewed follow list from ${relayUrl}: ${event.created_at}`,
                );
                return;
              }

              const isNewerAndRicher: boolean =
                event.created_at > latestFollowTimestamp &&
                event.tags.length >= latestFollowTags.length;
              const isSameSecondButRicher: boolean =
                event.created_at === latestFollowTimestamp &&
                event.tags.length > latestFollowTags.length;
              if (isNewerAndRicher || isSameSecondButRicher) {
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
            },
            onEose: (): void => {
              if (!relayResults.has(relayUrl)) {
                relayResults.set(relayUrl, {
                  gotEvent: false,
                  tagCount: 0,
                  createdAt: null,
                });
              }
              finish();
            },
            onClosed: (): void => {
              finish();
            },
          },
        )
          .then((nextUnsubscribe: () => void): void => {
            unsubscribe = nextUnsubscribe;
          })
          .catch((error: unknown): void => {
            console.error(`WebSocket error [${relayUrl}]`, error);
            finish();
          });
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
    let unsubscribe: (() => void) | null = null;

    const finish = (event: NostrEvent | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(event);
    };

    const timeout = setTimeout((): void => {
      recordRelayFailure(relayUrl);
      finish(null);
    }, timeoutMs);

    void openRelaySubscription(
      relayUrl,
      { ids: [eventId], limit: 1 },
      {
        onEvent: (event: NostrEvent): void => {
          finish(event);
        },
        onEose: (): void => {
          finish(null);
        },
        onClosed: (): void => {
          finish(null);
        },
      },
    )
      .then((nextUnsubscribe: () => void): void => {
        unsubscribe = nextUnsubscribe;
      })
      .catch((): void => {
        finish(null);
      });
  });
}

export async function fetchEventById(
  eventId: string,
  relays: string[],
): Promise<NostrEvent | null> {
  if (relays.length === 0) {
    return null;
  }

  const requests: Promise<NostrEvent>[] = relays.map(
    async (relayUrl: string): Promise<NostrEvent> => {
      try {
        const event: NostrEvent | null = await fetchEventFromRelay(
          eventId,
          relayUrl,
          5000,
        );
        if (!event) {
          throw new RelayMissError();
        }
        return event;
      } catch (e) {
        if (!(e instanceof RelayMissError)) {
          console.warn(`Failed to fetch event ${eventId} from ${relayUrl}:`, e);
        }
        throw e;
      }
    },
  );

  try {
    return await promiseAny(requests);
  } catch {
    // All relays missed or failed (AggregateError-like case for Promise.any).
    return null;
  }
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
          let unsubscribe: (() => void) | null = null;

          const finish = (value: boolean): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            unsubscribe?.();
            resolve(value);
          };

          const timeout = setTimeout((): void => {
            recordRelayFailure(relayUrl);
            finish(false);
          }, perRelayTimeoutMs);

          void openRelaySubscription(
            relayUrl,
            {
              kinds: [5],
              authors: [authorPubkey],
              '#e': [eventId],
              limit: 20,
            },
            {
              onEvent: (deleteEvent: NostrEvent): void => {
                if (deleteEvent.kind !== 5) {
                  return;
                }
              const referencesTarget: boolean = deleteEvent.tags.some(
                (tag: string[]): boolean =>
                  tag[0] === 'e' && tag[1] === eventId,
              );
              if (referencesTarget) {
                finish(true);
              }
              },
              onEose: (): void => {
                finish(false);
              },
              onClosed: (): void => {
                finish(false);
              },
            },
          )
            .then((nextUnsubscribe: () => void): void => {
              unsubscribe = nextUnsubscribe;
            })
            .catch((): void => {
              finish(false);
            });
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
      await new Promise<void>((resolve) => {
        let settled: boolean = false;
        let unsubscribe: (() => void) | null = null;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          unsubscribe?.();
          resolve();
        };

        const timeout = setTimeout(() => {
          recordRelayFailure(relayUrl);
          finish();
        }, 5000);

        void openRelaySubscription(
          relayUrl,
          { kinds: [1], '#e': [eventId], limit: 200 },
          {
            onEvent: (event: NostrEvent): void => {
              results.set(event.id, event);
            },
            onEose: (): void => {
              finish();
            },
            onClosed: (): void => {
              finish();
            },
          },
        )
          .then((nextUnsubscribe: () => void): void => {
            unsubscribe = nextUnsubscribe;
          })
          .catch((): void => {
            finish();
          });
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
