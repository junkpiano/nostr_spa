import { nip19 } from 'nostr-tools';
import type {
  NostrEvent,
  NostrProfile,
  Npub,
  PubkeyHex,
} from '../../../types/nostr';
import { getProfile as getCachedProfile } from '../../common/db/index.js';
import { renderEvent } from '../../common/event-render.js';
import { createRelayWebSocket } from '../../common/relay-socket.js';
import { fetchingProfiles, profileCache } from '../../common/timeline-cache.js';
import { getAvatarURL, getDisplayName } from '../../utils/utils.js';
import { fetchProfile } from '../profile/profile.js';

export interface SearchPageOptions {
  query: string;
  relays: string[];
  limit: number;
  output: HTMLElement | null;
  connectingMsg: HTMLElement | null;
  activeWebSockets?: WebSocket[];
  activeTimeouts?: number[];
  isRouteActive?: () => boolean;
}

const SEARCH_TIMEOUT_MS: number = 12000;

function updateSearchInputs(query: string): void {
  const searchInput: HTMLInputElement | null = document.getElementById(
    'search-input',
  ) as HTMLInputElement | null;
  const searchInputMobile: HTMLInputElement | null = document.getElementById(
    'search-input-mobile',
  ) as HTMLInputElement | null;
  const clearSearchButton: HTMLElement | null =
    document.getElementById('clear-search-button');
  const clearSearchButtonMobile: HTMLElement | null =
    document.getElementById('clear-search-button-mobile');
  if (searchInput) {
    searchInput.value = query;
  }
  if (searchInputMobile) {
    searchInputMobile.value = query;
  }
  const shouldShowClear: boolean = query.length > 0;
  if (clearSearchButton) {
    clearSearchButton.style.display = shouldShowClear ? '' : 'none';
  }
  if (clearSearchButtonMobile) {
    clearSearchButtonMobile.style.display = shouldShowClear ? '' : 'none';
  }
}

function updateSearchHeader(query: string, count: number): void {
  const postsHeader: HTMLElement | null =
    document.getElementById('posts-header');
  if (postsHeader) {
    if (!query) {
      postsHeader.textContent = 'Search';
    } else {
      const suffix: string = count > 0 ? ` (${count})` : '';
      postsHeader.textContent = `Search Results: "${query}"${suffix}`;
    }
    postsHeader.style.display = '';
  }
}

function showSearchMessage(output: HTMLElement, message: string): void {
  output.innerHTML = `
    <div class="text-center py-8">
      <p class="text-gray-700">${message}</p>
    </div>
  `;
}

function updateRenderedProfile(
  output: HTMLElement,
  pubkey: PubkeyHex,
  profile: NostrProfile | null,
): void {
  const eventElements: NodeListOf<Element> =
    output.querySelectorAll('.event-container');
  eventElements.forEach((el: Element): void => {
    if ((el as HTMLElement).dataset.pubkey !== pubkey) {
      return;
    }
    const nameEl: Element | null = el.querySelector('.event-username');
    const avatarEl: Element | null = el.querySelector('.event-avatar');
    if (profile) {
      if (nameEl) {
        const npubStr: Npub = nip19.npubEncode(pubkey);
        nameEl.textContent = `👤 ${getDisplayName(npubStr, profile)}`;
      }
      if (avatarEl) {
        (avatarEl as HTMLImageElement).src = getAvatarURL(pubkey, profile);
      }
    }
  });
}

export async function loadSearchPage(options: SearchPageOptions): Promise<void> {
  const {
    query,
    relays,
    limit,
    output,
    connectingMsg,
    activeWebSockets = [],
    activeTimeouts = [],
    isRouteActive,
  } = options;

  if (!output) {
    return;
  }

  const routeIsActive: () => boolean = isRouteActive || (() => true);
  updateSearchInputs(query);
  updateSearchHeader(query, 0);

  if (!query) {
    showSearchMessage(output, 'Enter a search query to begin.');
    if (connectingMsg) {
      connectingMsg.style.display = 'none';
    }
    return;
  }

  output.innerHTML = '';
  if (connectingMsg) {
    connectingMsg.style.display = '';
  }

  if (relays.length === 0) {
    showSearchMessage(output, 'No search relays configured.');
    if (connectingMsg) {
      connectingMsg.style.display = 'none';
    }
    return;
  }

  const seenEventIds: Set<string> = new Set();
  let renderedCount: number = 0;
  let completedRelays: number = 0;
  const totalRelays: number = relays.length;

  const finishSearch = (): void => {
    if (!routeIsActive()) {
      return;
    }
    if (connectingMsg) {
      connectingMsg.style.display = 'none';
    }
    updateSearchHeader(query, renderedCount);
    if (renderedCount === 0) {
      showSearchMessage(output, 'No results found.');
    }
  };

  const timeoutId: number = window.setTimeout((): void => {
    finishSearch();
  }, SEARCH_TIMEOUT_MS);
  activeTimeouts.push(timeoutId);

  const filter: Record<string, unknown> = {
    kinds: [1],
    search: query,
    limit,
  };

  relays.forEach((relayUrl: string): void => {
    if (!routeIsActive()) {
      return;
    }

    const socket: WebSocket = createRelayWebSocket(relayUrl, true);
    activeWebSockets.push(socket);
    const subId: string = `search-${Math.random().toString(36).slice(2)}`;
    let relayDone: boolean = false;

    const completeRelay = (): void => {
      if (relayDone) {
        return;
      }
      relayDone = true;
      completedRelays += 1;
      if (completedRelays >= totalRelays) {
        window.clearTimeout(timeoutId);
        finishSearch();
      }
    };

    socket.onopen = (): void => {
      const req = ['REQ', subId, filter];
      socket.send(JSON.stringify(req));
    };

    socket.onmessage = (msg: MessageEvent): void => {
      if (!routeIsActive()) {
        socket.close();
        return;
      }

      try {
        const data = JSON.parse(msg.data);
        if (data[0] === 'EVENT' && data[1] === subId) {
          const event: NostrEvent = data[2];
          if (!event || !event.id || seenEventIds.has(event.id)) {
            return;
          }
          seenEventIds.add(event.id);
          renderedCount += 1;

          if (connectingMsg) {
            connectingMsg.style.display = 'none';
          }

          let profile: NostrProfile | null =
            profileCache.get(event.pubkey) || null;
          if (!profileCache.has(event.pubkey)) {
            void getCachedProfile(event.pubkey as PubkeyHex).then(
              (cached: NostrProfile | null): void => {
                if (!routeIsActive()) return;
                profileCache.set(event.pubkey, cached);
                if (cached) {
                  updateRenderedProfile(
                    output,
                    event.pubkey as PubkeyHex,
                    cached,
                  );
                }
              },
            );
          }

          if (
            !profileCache.has(event.pubkey) &&
            !fetchingProfiles.has(event.pubkey)
          ) {
            fetchingProfiles.add(event.pubkey);
            fetchProfile(event.pubkey, relays, {
              usePersistentCache: false,
              persistProfile: false,
            })
              .then((fetchedProfile: NostrProfile | null): void => {
                if (!routeIsActive()) return;
                profileCache.set(event.pubkey, fetchedProfile);
                fetchingProfiles.delete(event.pubkey);
                updateRenderedProfile(
                  output,
                  event.pubkey as PubkeyHex,
                  fetchedProfile,
                );
              })
              .catch((error: unknown): void => {
                console.error(
                  `[Search] Failed to fetch profile for ${event.pubkey}`,
                  error,
                );
                profileCache.set(event.pubkey, null);
                fetchingProfiles.delete(event.pubkey);
              });
          }

          const npubStr: Npub = nip19.npubEncode(event.pubkey);
          renderEvent(event, profile, npubStr, event.pubkey, output);
          updateSearchHeader(query, renderedCount);
          return;
        }

        if (data[0] === 'EOSE' && data[1] === subId) {
          socket.close();
          completeRelay();
        }
      } catch (error: unknown) {
        console.warn(`[Search] Failed to parse message from ${relayUrl}:`, error);
      }
    };

    socket.onerror = (): void => {
      socket.close();
      completeRelay();
    };

    socket.onclose = (): void => {
      completeRelay();
    };
  });
}
