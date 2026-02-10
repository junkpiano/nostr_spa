import type { NostrEvent, PubkeyHex } from "../types/nostr";

export async function fetchFollowList(pubkeyHex: PubkeyHex, relays: string[]): Promise<PubkeyHex[]> {
  console.log(`Fetching follow list for ${pubkeyHex}`);
  let latestFollowTimestamp: number = -1;
  let latestFollowTags: string[][] = [];

  const relayResults: Map<string, { gotEvent: boolean; tagCount: number; createdAt: number | null }> = new Map();

  const promises = relays.map(async (relayUrl: string): Promise<void> => {
    try {
      const socket: WebSocket = new WebSocket(relayUrl);
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
          finish();
        }, 8000);

        socket.onopen = (): void => {
          const subId: string = "follows-" + Math.random().toString(36).slice(2);
          const req: [string, string, { kinds: number[]; authors: string[]; limit: number }] = [
            "REQ",
            subId,
            { kinds: [3], authors: [pubkeyHex], limit: 20 },
          ];
          console.log(`Requesting follows from ${relayUrl}`);
          socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === "EVENT" && arr[2]?.kind === 3) {
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
          } else if (arr[0] === "EOSE") {
            if (!relayResults.has(relayUrl)) {
              relayResults.set(relayUrl, { gotEvent: false, tagCount: 0, createdAt: null });
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
    if (tag[0] === "p" && tag[1]) {
      followedPubkeys.add(tag[1] as PubkeyHex);
    }
  });

  console.log(`Follow list relay summary:`, Array.from(relayResults.entries()));
  console.log(
    `Using latest kind 3 event at ${latestFollowTimestamp >= 0 ? latestFollowTimestamp : "n/a"}, total follows: ${followedPubkeys.size}`,
  );
  return Array.from(followedPubkeys);
}

export async function fetchEventById(eventId: string, relays: string[]): Promise<NostrEvent | null> {
  for (const relayUrl of relays) {
    try {
      const socket: WebSocket = new WebSocket(relayUrl);
      const event: NostrEvent | null = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error("Timeout"));
        }, 5000);

        socket.onopen = (): void => {
          const subId: string = "event-" + Math.random().toString(36).slice(2);
          const req: [string, string, { ids: string[]; limit: number }] = [
            "REQ",
            subId,
            { ids: [eventId], limit: 1 },
          ];
          socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === "EVENT") {
            clearTimeout(timeout);
            socket.close();
            resolve(arr[2] as NostrEvent);
          } else if (arr[0] === "EOSE") {
            clearTimeout(timeout);
            socket.close();
            resolve(null);
          }
        };

        socket.onerror = (err: Event): void => {
          clearTimeout(timeout);
          socket.close();
          reject(err);
        };
      });

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
  const checks = relays.map(async (relayUrl: string): Promise<boolean> => {
    try {
      const socket: WebSocket = new WebSocket(relayUrl);
      return await new Promise<boolean>((resolve) => {
        let settled: boolean = false;
        const finish = (deleted: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.close();
          resolve(deleted);
        };

        const timeout = setTimeout(() => {
          finish(false);
        }, 5000);

        socket.onopen = (): void => {
          const subId: string = "deleted-" + Math.random().toString(36).slice(2);
          const req: [string, string, { kinds: number[]; authors: string[]; "#e": string[]; limit: number }] = [
            "REQ",
            subId,
            {
              kinds: [5],
              authors: [authorPubkey],
              "#e": [eventId],
              limit: 20,
            },
          ];
          socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === "EVENT" && arr[2]?.kind === 5) {
            const deleteEvent: NostrEvent = arr[2];
            const referencesTarget: boolean = deleteEvent.tags.some(
              (tag: string[]): boolean => tag[0] === "e" && tag[1] === eventId,
            );
            if (referencesTarget) {
              finish(true);
              return;
            }
          } else if (arr[0] === "EOSE") {
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
  });

  const results: boolean[] = await Promise.all(checks);
  return results.some(Boolean);
}
