import { nip19 } from 'nostr-tools';
import { getAvatarURL, getDisplayName } from "../../utils/utils.js";
import { fetchProfile } from "../profile/profile.js";
import { renderEvent } from "../../common/event-render.js";
import { fetchingProfiles, profileCache } from "../../common/timeline-cache.js";
import { createRelayWebSocket } from "../../common/relay-socket.js";
import type { NostrProfile, PubkeyHex, Npub, NostrEvent } from "../../../types/nostr";

export async function loadHomeTimeline(
  followedPubkeys: PubkeyHex[],
  kinds: number[],
  relays: string[],
  limit: number,
  untilTimestamp: number,
  seenEventIds: Set<string>,
  output: HTMLElement,
  connectingMsg: HTMLElement | null,
  activeWebSockets: WebSocket[] = [],
  activeTimeouts: number[] = [],
  isRouteActive?: () => boolean,
): Promise<void> {
  const routeIsActive: () => boolean = isRouteActive || (() => true);
  if (!routeIsActive()) {
    return;
  }
  let flushScheduled: boolean = false;
  let pendingRelays: number = relays.length;
  const bufferedEvents: NostrEvent[] = [];
  const renderedEventIds: Set<string> = new Set();
  let finalized: boolean = false;
  let clearedPlaceholder: boolean = false;

  if (followedPubkeys.length === 0) {
    if (output) {
      output.innerHTML = `
                <div class="text-center py-8">
                    <p class="text-gray-700 mb-4">No authors specified for home timeline.</p>
                </div>
            `;
    }
    return;
  }

  const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");

  if (connectingMsg) {
    connectingMsg.style.display = ""; // Show connecting message
  }

  if (loadMoreBtn) {
    (loadMoreBtn as HTMLButtonElement).disabled = true;
    loadMoreBtn.classList.add("opacity-50", "cursor-not-allowed");
  }

  const flushBufferedEvents = (): void => {
    if (!routeIsActive()) {
      return;
    }
    bufferedEvents.sort((a: NostrEvent, b: NostrEvent): number => b.created_at - a.created_at);

    if (!clearedPlaceholder && bufferedEvents.length > 0) {
      output.innerHTML = "";
      clearedPlaceholder = true;
    }

    bufferedEvents.forEach((event: NostrEvent): void => {
      if (renderedEventIds.has(event.id)) {
        return;
      }
      renderedEventIds.add(event.id);

      // Fetch profile for this event's author if not cached
      let profile: NostrProfile | null = profileCache.get(event.pubkey) || null;
      if (!profileCache.has(event.pubkey) && !fetchingProfiles.has(event.pubkey)) {
        fetchingProfiles.add(event.pubkey);
        fetchProfile(event.pubkey, relays)
          .then((fetchedProfile: NostrProfile | null): void => {
            profileCache.set(event.pubkey, fetchedProfile);
            fetchingProfiles.delete(event.pubkey);
            // Update the rendered event with the fetched profile
            const eventElements: NodeListOf<Element> = output.querySelectorAll(".event-container");
            eventElements.forEach((el: Element): void => {
              if ((el as HTMLElement).dataset.pubkey === event.pubkey) {
                const nameEl: Element | null = el.querySelector(".event-username");
                const avatarEl: Element | null = el.querySelector(".event-avatar");
                if (fetchedProfile) {
                  if (nameEl) {
                    const npubStr: Npub = nip19.npubEncode(event.pubkey);
                    nameEl.textContent = `👤 ${getDisplayName(npubStr, fetchedProfile)}`;
                  }
                  if (avatarEl) {
                    (avatarEl as HTMLImageElement).src = getAvatarURL(event.pubkey, fetchedProfile);
                  }
                }
              }
            });
          })
          .catch((err: unknown): void => {
            console.error(`Failed to fetch profile for ${event.pubkey}`, err);
            profileCache.set(event.pubkey, null);
            fetchingProfiles.delete(event.pubkey);
          });
      }

      const npubStr: Npub = nip19.npubEncode(event.pubkey);
      renderEvent(event, profile, npubStr, event.pubkey, output);
      untilTimestamp = Math.min(untilTimestamp, event.created_at);
    });

    if (connectingMsg && renderedEventIds.size > 0) {
      connectingMsg.style.display = "none";
    }
  };

  const finalizeLoading = (): void => {
    if (!routeIsActive()) {
      return;
    }
    if (finalized) {
      return;
    }
    finalized = true;
    flushBufferedEvents();

    if (renderedEventIds.size === 0 && seenEventIds.size === 0) {
      output.innerHTML = "<p class='text-red-500'>No posts found from selected kinds.</p>";
    }

    if (loadMoreBtn) {
      (loadMoreBtn as HTMLButtonElement).disabled = false;
      loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
      if (renderedEventIds.size > 0) {
        loadMoreBtn.style.display = "inline";
      }
    }

    if (connectingMsg) {
      connectingMsg.style.display = "none";
    }
  };

  const scheduleFlush = (): void => {
    if (flushScheduled) return;
    flushScheduled = true;
    const timeoutId = window.setTimeout((): void => {
      flushScheduled = false;
      flushBufferedEvents();
    }, 300);
    activeTimeouts.push(timeoutId);
  };

  for (const relayUrl of relays) {
    const socket: WebSocket = createRelayWebSocket(relayUrl);
    activeWebSockets.push(socket);

    socket.onopen = (): void => {
      if (!routeIsActive()) {
        socket.close();
        return;
      }
      const subId: string = "home-" + Math.random().toString(36).slice(2);
      const req: [string, string, { kinds: number[]; authors: string[]; until: number; limit: number }] = [
        "REQ",
        subId,
        {
          kinds: kinds,
          authors: followedPubkeys,
          until: untilTimestamp,
          limit: limit,
        },
      ];
      socket.send(JSON.stringify(req));
    };

    socket.onmessage = async (msg: MessageEvent): Promise<void> => {
      if (!routeIsActive()) {
        return;
      }
      const arr: any[] = JSON.parse(msg.data);
      if (arr[0] === "EVENT") {
        const event: NostrEvent = arr[2];
        if (seenEventIds.has(event.id)) return;
        seenEventIds.add(event.id);

        if (connectingMsg) {
          connectingMsg.style.display = "none";
        }

        bufferedEvents.push(event);
        scheduleFlush();
      } else if (arr[0] === "EOSE") {
        socket.close();
        pendingRelays -= 1;
        if (pendingRelays <= 0) {
          finalizeLoading();
        } else {
          scheduleFlush();
        }
      }
    };

    socket.onerror = (err: Event): void => {
      if (!routeIsActive()) {
        return;
      }
      console.error(`WebSocket error [${relayUrl}]`, err);
      if (connectingMsg) {
        connectingMsg.style.display = "none";
      }
      if (loadMoreBtn) {
        (loadMoreBtn as HTMLButtonElement).disabled = false;
        loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
      }
      pendingRelays -= 1;
      if (pendingRelays <= 0) {
        finalizeLoading();
      } else {
        scheduleFlush();
      }
    };
  }

  if (loadMoreBtn) {
    // Remove old listeners and add new one
    const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(true) as HTMLElement;
    loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
    newLoadMoreBtn.addEventListener("click", (): Promise<void> =>
      loadHomeTimeline(
        followedPubkeys,
        kinds,
        relays,
        limit,
        untilTimestamp,
        seenEventIds,
        output,
        connectingMsg,
        activeWebSockets,
        activeTimeouts,
        routeIsActive,
      ),
    );
  }
}
