import { nip19 } from 'nostr-tools';
import { getAvatarURL, getDisplayName } from "../../utils/utils.js";
import { fetchProfile } from "../profile/profile.js";
import { renderEvent } from "../../common/event-render.js";
import { fetchingProfiles, profileCache } from "../../common/timeline-cache.js";
import { createRelayWebSocket } from "../../common/relay-socket.js";
import type { NostrProfile, Npub, NostrEvent } from "../../../types/nostr";

export async function loadGlobalTimeline(
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
  const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");
  let clearedPlaceholder: boolean = false;

  if (connectingMsg) {
    connectingMsg.style.display = ""; // Show connecting message
  }

  if (loadMoreBtn) {
    (loadMoreBtn as HTMLButtonElement).disabled = true;
    loadMoreBtn.classList.add("opacity-50", "cursor-not-allowed");
  }

  for (const relayUrl of relays) {
    const socket: WebSocket = createRelayWebSocket(relayUrl);
    activeWebSockets.push(socket);

    socket.onopen = (): void => {
      if (!routeIsActive()) {
        socket.close();
        return;
      }
      const subId: string = "global-" + Math.random().toString(36).slice(2);
      const req: [string, string, { kinds: number[]; until: number; limit: number }] = [
        "REQ",
        subId,
        {
          kinds: [1, 6, 16],
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

        if (!clearedPlaceholder) {
          output.innerHTML = "";
          clearedPlaceholder = true;
        }

        if (connectingMsg) {
          connectingMsg.style.display = "none";
        }

        // Fetch profile for this event's author if not cached
        let profile: NostrProfile | null = profileCache.get(event.pubkey) || null;
        if (!profileCache.has(event.pubkey) && !fetchingProfiles.has(event.pubkey)) {
          // Mark as being fetched to avoid duplicate requests
          fetchingProfiles.add(event.pubkey);
          // Fetch profile asynchronously
          fetchProfile(event.pubkey, relays, {
            usePersistentCache: false,
            persistProfile: false,
          })
            .then((fetchedProfile: NostrProfile | null): void => {
              profileCache.set(event.pubkey, fetchedProfile);
              fetchingProfiles.delete(event.pubkey);
              // Update the rendered event with the fetched profile
              // Find and update the event's display
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
      } else if (arr[0] === "EOSE") {
        socket.close();
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
    };
  }

  const timeoutId = window.setTimeout((): void => {
    if (!routeIsActive()) {
      return;
    }
    // Only show error if no events exist in the DOM and seenEventIds is still empty
    const hasEvents = output.querySelectorAll(".event-container").length > 0;
    if (!hasEvents && seenEventIds.size === 0) {
      output.innerHTML = "<p class='text-red-500'>No events found on global timeline.</p>";
    }

    if (connectingMsg) {
      connectingMsg.style.display = "none";
    }

    if (loadMoreBtn) {
      (loadMoreBtn as HTMLButtonElement).disabled = false;
      loadMoreBtn.classList.remove("opacity-50", "cursor-not-allowed");
      // Only show load more button if we have events
      if (hasEvents || seenEventIds.size > 0) {
        loadMoreBtn.style.display = "inline";
      }
    }
  }, 5000); // Increased to 5 seconds to give more time for events to load
  activeTimeouts.push(timeoutId);

  if (loadMoreBtn) {
    // Remove old listeners and add new one
    const newLoadMoreBtn: HTMLElement = loadMoreBtn.cloneNode(true) as HTMLElement;
    loadMoreBtn.parentNode?.replaceChild(newLoadMoreBtn, loadMoreBtn);
    newLoadMoreBtn.addEventListener("click", (): Promise<void> =>
      loadGlobalTimeline(
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
