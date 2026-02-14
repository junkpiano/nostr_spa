import { nip19 } from 'nostr-tools';
import type {
  NostrEvent,
  NostrProfile,
  Npub,
  PubkeyHex,
} from '../../types/nostr';
import { setupComposeOverlay } from '../common/compose.js';
import {
  deleteTimeline,
  getCachedTimeline,
  getProfile as getCachedProfile,
  getTimelineNewestTimestamp,
} from '../common/db/index.js';
import { renderEvent } from '../common/event-render.js';
import { setActiveNav, setupNavigation } from '../common/navigation.js';
import { isNip05Identifier, resolveNip05 } from '../common/nip05.js';
import { setupImageOverlay } from '../common/overlays.js';
import { createRelayWebSocket } from '../common/relay-socket.js';
import { setupReplyOverlay } from '../common/reply.js';
import { setupSearchBar } from '../common/search.js';
import {
  clearSessionPrivateKey,
  getSessionPrivateKey,
  setSessionPrivateKeyFromRaw,
  updateLogoutButton,
} from '../common/session.js';
import {
  registerServiceWorker,
  startPeriodicSync,
} from '../common/sync/service-worker-manager.js';
import { loadAboutPage } from '../features/about/about-page.js';
import { broadcastRecentPosts } from '../features/broadcast/broadcast.js';
import { loadEventPage } from '../features/event/event-page.js';
import { loadGlobalTimeline } from '../features/global/global-timeline.js';
import { loadUserHomeTimeline } from '../features/home/home-loader.js';
import { loadHomeTimeline } from '../features/home/home-timeline.js';
import { showInputForm } from '../features/home/welcome.js';
import {
  clearNotifications,
  loadNotificationsPage,
} from '../features/notifications/notifications.js';
import { loadReactionsPage } from '../features/reactions/reactions-page.js';
import {
  publishEventToRelays,
  setupFollowToggle,
} from '../features/profile/follow.js';
import { fetchProfile, renderProfile } from '../features/profile/profile.js';
import { loadEvents } from '../features/profile/profile-events.js';
import {
  getAllRelays,
  getRelays,
  didUserConfigureRelays,
  normalizeRelayUrl,
  recordRelayFailure,
  setRelays,
} from '../features/relays/relays.js';
import {
  fetchNip65RelayList,
  signNip65RelayListEvent,
} from '../features/relays/nip65.js';
import { loadRelaysPage } from '../features/relays/relays-page.js';
import { loadSettingsPage } from '../features/settings/settings-page.js';

const output: HTMLElement | null = document.getElementById('nostr-output');
const profileSection: HTMLElement | null =
  document.getElementById('profile-section');
const composeButton: HTMLElement | null =
  document.getElementById('nav-compose');
const connectingMsg: HTMLElement | null =
  document.getElementById('connecting-msg');
let relays: string[] = getRelays();
// Fetch a solid chunk up-front; pagination ("Load more") is currently disabled for stability.
const limit: number = 200;
const seenEventIds: Set<string> = new Set();
let untilTimestamp: number = Math.floor(Date.now() / 1000);
let profile: NostrProfile | null = null;
const homeKinds: number[] = [1, 2, 6, 9, 11, 16, 22, 28, 40, 70, 77];

type AppHistoryState = {
  __nostrSpa?: true;
  scrollX?: number;
  scrollY?: number;
  timeline?: {
    type: 'home' | 'global';
    count: number;
  };
};

// Cache for home timeline
let cachedHomeTimeline: {
  events: any[];
  followedPubkeys: string[];
  timestamp: number;
} | null = null;
let backgroundFetchInterval: number | null = null;
let newestEventTimestamp: number = Math.floor(Date.now() / 1000);
let activeRouteToken: number = 0;

// Track active WebSocket connections
let activeWebSockets: WebSocket[] = [];
// Track active timeouts
let activeTimeouts: number[] = [];

async function importRelaysFromNip65(): Promise<void> {
  const storedPubkey: string | null = localStorage.getItem('nostr_pubkey');
  if (!storedPubkey) {
    throw new Error('Sign-in required.');
  }

  const result = await fetchNip65RelayList({
    pubkeyHex: storedPubkey as PubkeyHex,
    relays: getRelays(),
  });

  if (!result || result.relayUrls.length === 0) {
    throw new Error('No NIP-65 relay list found.');
  }

  setRelays(result.relayUrls);
  syncRelays();
}

async function publishRelaysToNip65(): Promise<void> {
  const storedPubkey: string | null = localStorage.getItem('nostr_pubkey');
  if (!storedPubkey) {
    throw new Error('Sign-in required.');
  }

  const relayUrls: string[] = getRelays();
  const event: NostrEvent = await signNip65RelayListEvent({
    pubkeyHex: storedPubkey as PubkeyHex,
    relayUrls,
  });
  await publishEventToRelays(event, relayUrls);
}

async function maybeSyncRelaysFromNip65OnLogin(): Promise<void> {
  const storedPubkey: string | null = localStorage.getItem('nostr_pubkey');
  if (!storedPubkey) return;

  // Don't surprise users who already customized relays in this browser.
  if (didUserConfigureRelays()) return;

  try {
    await importRelaysFromNip65();
  } catch (error: unknown) {
    // Best-effort only. Keep defaults if NIP-65 fetch fails or doesn't exist.
    console.log('[NIP-65] No relay list imported on login:', error);
  }
}

function renderLoadingState(message: string, subMessage: string = ''): void {
  if (!output) {
    return;
  }

  output.innerHTML = `
    <div class="text-center py-12">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
      <p class="text-gray-700 font-semibold">${message}</p>
      ${subMessage ? `<p class="text-gray-500 text-sm mt-2">${subMessage}</p>` : ''}
    </div>
  `;
}

// Close all active WebSocket connections and clear timeouts
function closeAllWebSockets(): void {
  activeWebSockets.forEach((socket: WebSocket): void => {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
  });
  activeWebSockets = [];

  // Clear all active timeouts
  activeTimeouts.forEach((timeoutId: number): void => {
    clearTimeout(timeoutId);
  });
  activeTimeouts = [];
}

function createRouteGuard(): () => boolean {
  activeRouteToken += 1;
  const token: number = activeRouteToken;
  return (): boolean => token === activeRouteToken;
}

function getCurrentHistoryStateObject(): Record<string, unknown> {
  const state: unknown = window.history.state;
  if (state && typeof state === 'object') {
    return state as Record<string, unknown>;
  }
  return {};
}

function getCurrentTimelineHistoryHint():
  | AppHistoryState['timeline']
  | undefined {
  const path: string = window.location.pathname;
  if (path !== '/home' && path !== '/global') {
    return undefined;
  }
  const count: number = document.querySelectorAll('.event-container').length;
  if (count <= 0) {
    return undefined;
  }
  return {
    type: path === '/home' ? 'home' : 'global',
    count,
  };
}

function saveScrollToHistoryState(): void {
  const base: Record<string, unknown> = getCurrentHistoryStateObject();
  const nextState: AppHistoryState & Record<string, unknown> = {
    ...base,
    __nostrSpa: true,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
  const timelineHint: AppHistoryState['timeline'] | undefined =
    getCurrentTimelineHistoryHint();
  if (timelineHint) {
    nextState.timeline = timelineHint;
  } else {
    // With exactOptionalPropertyTypes, explicitly writing `timeline: undefined`
    // is not the same as omitting the property.
    delete (nextState as any).timeline;
  }
  const url: string =
    window.location.pathname + window.location.search + window.location.hash;
  window.history.replaceState(nextState, '', url);
}

function pushAppHistoryPath(path: string): void {
  const nextState: AppHistoryState = {
    __nostrSpa: true,
    scrollX: 0,
    scrollY: 0,
  };
  window.history.pushState(nextState, '', path);
}

function replaceAppHistoryPath(path: string): void {
  const nextState: AppHistoryState = {
    __nostrSpa: true,
    scrollX: 0,
    scrollY: 0,
  };
  window.history.replaceState(nextState, '', path);
}

async function restoreScrollFromState(state: unknown): Promise<void> {
  const s: any = state;
  const x: number = typeof s?.scrollX === 'number' ? s.scrollX : 0;
  const y: number = typeof s?.scrollY === 'number' ? s.scrollY : 0;

  // Timeline rendering is async; give layout a couple of frames, then try a few times.
  for (let i: number = 0; i < 10; i += 1) {
    await new Promise<void>((resolve: () => void): void => {
      window.requestAnimationFrame((): void => {
        window.requestAnimationFrame((): void => resolve());
      });
    });
    window.scrollTo(x, y);
    if (Math.abs(window.scrollY - y) <= 2) {
      return;
    }
    await new Promise<void>((resolve: () => void): void => {
      window.setTimeout(resolve, 60);
    });
  }
}

function getRestoreTimelineCount(
  state: unknown,
  expectedType: 'home' | 'global',
): number {
  if (!state || typeof state !== 'object') {
    return 0;
  }
  const s: any = state;
  const timeline = s?.timeline;
  if (!timeline || typeof timeline !== 'object') {
    return 0;
  }
  if (timeline.type !== expectedType) {
    return 0;
  }
  const count: number = typeof timeline.count === 'number' ? timeline.count : 0;
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

// Pagination ("Load more") is currently disabled for stability.

async function restoreTimelineFromCache(params: {
  type: 'home' | 'global';
  userPubkey?: PubkeyHex | undefined;
  desiredCount: number;
  isRouteActive: () => boolean;
}): Promise<{
  restored: boolean;
  oldestTimestamp: number;
  newestTimestamp: number;
}> {
  if (!output || !params.isRouteActive()) {
    return { restored: false, oldestTimestamp: 0, newestTimestamp: 0 };
  }

  const desiredCount: number = Math.max(1, Math.min(params.desiredCount, 500));
  const cached = await getCachedTimeline(params.type, params.userPubkey, {
    limit: desiredCount,
  });
  if (!params.isRouteActive()) {
    return { restored: false, oldestTimestamp: 0, newestTimestamp: 0 };
  }
  if (!cached.hasCache || cached.events.length === 0) {
    return { restored: false, oldestTimestamp: 0, newestTimestamp: 0 };
  }

  // Render cached events (no relay fetch). This is used for browser back/forward restore.
  output.innerHTML = '';
  seenEventIds.clear();

  const uniquePubkeys: PubkeyHex[] = Array.from(
    new Set(cached.events.map((e: NostrEvent) => e.pubkey as PubkeyHex)),
  );
  const profiles: Array<NostrProfile | null> = await Promise.all(
    uniquePubkeys.map(async (pk: PubkeyHex): Promise<NostrProfile | null> => {
      try {
        return await getCachedProfile(pk);
      } catch {
        return null;
      }
    }),
  );
  const profileMap: Map<PubkeyHex, NostrProfile | null> = new Map(
    uniquePubkeys.map((pk: PubkeyHex, i: number) => [pk, profiles[i] ?? null]),
  );

  for (const event of cached.events) {
    if (!params.isRouteActive()) {
      return { restored: false, oldestTimestamp: 0, newestTimestamp: 0 };
    }
    seenEventIds.add(event.id);
    const profile: NostrProfile | null =
      profileMap.get(event.pubkey as PubkeyHex) || null;
    const npubStr: Npub = nip19.npubEncode(event.pubkey);
    renderEvent(event, profile, npubStr, event.pubkey, output);
  }

  if (connectingMsg) {
    connectingMsg.style.display = 'none';
  }

  const loadMoreBtn: HTMLButtonElement | null = document.getElementById(
    'load-more',
  ) as HTMLButtonElement | null;
  if (loadMoreBtn) {
    loadMoreBtn.disabled = false;
    loadMoreBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    loadMoreBtn.style.display = 'inline';
  }

  return {
    restored: true,
    oldestTimestamp: cached.oldestTimestamp,
    newestTimestamp: cached.newestTimestamp,
  };
}

function syncRelays(): void {
  relays = getRelays();
}

function showNewEventsNotification(_timelineType: string, count: number): void {
  // Remove existing notification if any
  const existingNotification = document.getElementById(
    'sw-new-events-notification',
  );
  if (existingNotification) {
    existingNotification.remove();
  }

  // Create notification banner
  const notification = document.createElement('div');
  notification.id = 'sw-new-events-notification';
  notification.className =
    'fixed top-16 left-1/2 transform -translate-x-1/2 z-50 bg-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 cursor-pointer hover:bg-indigo-700 transition-colors';
  notification.innerHTML = `
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
    </svg>
    <span>${count} new ${count === 1 ? 'post' : 'posts'} available</span>
    <button class="ml-2 text-sm underline">Refresh</button>
  `;

  notification.addEventListener('click', (): void => {
    // Force a relay refresh instead of going through handleRoute(), because
    // handleRoute() may restore from cache for back/forward navigations.
    void (async (): Promise<void> => {
      notification.remove();

      const path: string = window.location.pathname;
      if (path === '/home') {
        const storedPubkey: string | null =
          localStorage.getItem('nostr_pubkey');
        if (!storedPubkey || !output) {
          handleRoute();
          return;
        }

        // Prefer the cached follow list; fall back to refetching if missing.
        const followedPubkeys: PubkeyHex[] =
          (cachedHomeTimeline?.followedPubkeys as PubkeyHex[] | undefined) ||
          [];

        output.innerHTML = '';
        seenEventIds.clear();
        untilTimestamp = Math.floor(Date.now() / 1000);
        newestEventTimestamp = untilTimestamp;

        const routeGuard: () => boolean = createRouteGuard();
        if (followedPubkeys.length > 0) {
          await loadHomeTimeline(
            followedPubkeys,
            homeKinds,
            relays,
            limit,
            untilTimestamp,
            seenEventIds,
            output,
            connectingMsg,
            activeWebSockets,
            activeTimeouts,
            routeGuard,
            storedPubkey as PubkeyHex,
          );
        } else {
          await loadUserHomeTimeline({
            pubkeyHex: storedPubkey as PubkeyHex,
            relays,
            output,
            profileSection,
            connectingMsg,
            homeKinds,
            limit,
            seenEventIds,
            activeWebSockets,
            activeTimeouts,
            setUntilTimestamp: (value: number): void => {
              untilTimestamp = value;
            },
            setNewestEventTimestamp: (value: number): void => {
              newestEventTimestamp = value;
            },
            setCachedHomeTimeline: (
              followedWithSelf: PubkeyHex[],
              seen: Set<string>,
            ): void => {
              cachedHomeTimeline = {
                events: Array.from(seen),
                followedPubkeys: followedWithSelf,
                timestamp: Date.now(),
              };
            },
            startBackgroundFetch,
            isRouteActive: routeGuard,
          });
        }

        // Best-effort: align the background fetch cursor to the newest cached event.
        try {
          const newest: number = await getTimelineNewestTimestamp(
            'home',
            storedPubkey as PubkeyHex,
          );
          if (Number.isFinite(newest) && newest > 0) {
            newestEventTimestamp = newest;
          }
        } catch {
          // Best-effort only.
        }
        return;
      }

      if (path === '/global') {
        if (!output) {
          handleRoute();
          return;
        }

        output.innerHTML = '';
        seenEventIds.clear();
        untilTimestamp = Math.floor(Date.now() / 1000);

        const routeGuard: () => boolean = createRouteGuard();
        await loadGlobalTimeline(
          relays,
          limit,
          untilTimestamp,
          seenEventIds,
          output,
          connectingMsg,
          activeWebSockets,
          activeTimeouts,
          routeGuard,
        );
        return;
      }

      // Fallback for other routes.
      handleRoute();
    })();
  });

  document.body.appendChild(notification);

  // Auto-hide after 10 seconds
  setTimeout((): void => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 10000);
}
document.addEventListener('DOMContentLoaded', (): void => {
  if ('scrollRestoration' in window.history) {
    window.history.scrollRestoration = 'manual';
  }

  // Ensure the initial history entry has state we can mutate as the user scrolls.
  saveScrollToHistoryState();

  let scrollSyncTimer: number | null = null;
  window.addEventListener(
    'scroll',
    (): void => {
      if (scrollSyncTimer !== null) {
        return;
      }
      scrollSyncTimer = window.setTimeout((): void => {
        scrollSyncTimer = null;
        saveScrollToHistoryState();
      }, 150);
    },
    { passive: true },
  );

  window.addEventListener('relays-updated', syncRelays);
  if (connectingMsg) {
    connectingMsg.style.display = 'none'; // Hide connecting message by default
  }

  // Register service worker for background sync
  registerServiceWorker()
    .then((success: boolean): void => {
      if (success) {
        console.log('[App] Service worker registered successfully');
      }
    })
    .catch((error: unknown): void => {
      console.error('[App] Failed to register service worker:', error);
    });

  // Listen for new events from service worker
  window.addEventListener('sw-new-events', ((event: CustomEvent): void => {
    const { timelineType, count } = event.detail;
    console.log(
      `[App] Service worker found ${count} new events for ${timelineType} timeline`,
    );

    // Show notification banner
    showNewEventsNotification(timelineType, count);
  }) as EventListener);

  // Setup search functionality
  setupSearchBar(output);

  // Setup navigation
  setupNavigation({
    navigateTo: (path: string): void => {
      saveScrollToHistoryState();
      pushAppHistoryPath(path);
      handleRoute();
    },
    onLogout: handleLogout,
  });

  // If the user hasn't customized relays yet, try to discover their NIP-65 relay list.
  void maybeSyncRelaysFromNip65OnLogin();

  // Setup image overlay
  setupImageOverlay();

  // Setup composer overlay
  setupComposeOverlay({
    composeButton,
    getSessionPrivateKey,
    getRelays: (): string[] => relays,
    publishEvent: publishEventToRelays,
    refreshTimeline: async (): Promise<void> => {
      const isRouteActive: () => boolean = createRouteGuard();
      if (window.location.pathname === '/home') {
        await loadHomePage(isRouteActive);
      } else if (window.location.pathname === '/global') {
        await loadGlobalPage(isRouteActive);
      }
    },
  });

  // Setup reply overlay
  setupReplyOverlay({
    getSessionPrivateKey,
    getRelays: (): string[] => relays,
    publishEvent: publishEventToRelays,
    refreshTimeline: async (): Promise<void> => {
      const isRouteActive: () => boolean = createRouteGuard();
      if (window.location.pathname === '/home') {
        await loadHomePage(isRouteActive);
      } else if (window.location.pathname === '/global') {
        await loadGlobalPage(isRouteActive);
      }
    },
  });

  document.addEventListener('click', (event: MouseEvent): void => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target: HTMLElement | null = event.target as HTMLElement | null;
    const anchor: HTMLAnchorElement | null = target
      ? target.closest('a')
      : null;
    if (
      !anchor ||
      anchor.target === '_blank' ||
      anchor.hasAttribute('download')
    ) {
      return;
    }

    const href: string | null = anchor.getAttribute('href');
    if (!href || !href.startsWith('/')) {
      return;
    }

    const url: URL = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      return;
    }

    event.preventDefault();
    saveScrollToHistoryState();
    pushAppHistoryPath(url.pathname);
    handleRoute();
  });

  // Handle initial route
  handleRoute();
});

// Cleanup background fetch on page unload
window.addEventListener('beforeunload', (): void => {
  if (backgroundFetchInterval) {
    clearInterval(backgroundFetchInterval);
  }
});

// Handle browser back/forward buttons
window.addEventListener('popstate', (event: PopStateEvent): void => {
  handleRoute(event.state);
});

// Router function
function handleRoute(scrollRestoreState?: unknown): void {
  const isRouteActive: () => boolean = createRouteGuard();
  const path: string = window.location.pathname;
  updateLogoutButton(composeButton);
  const storedPubkey: string | null = localStorage.getItem('nostr_pubkey');
  const notificationsButton: HTMLElement | null =
    document.getElementById('nav-notifications');
  if (notificationsButton) {
    notificationsButton.style.display = storedPubkey ? '' : 'none';
  }
  const reactionsButton: HTMLElement | null =
    document.getElementById('nav-reactions');
  if (reactionsButton) {
    reactionsButton.style.display = storedPubkey ? '' : 'none';
  }

  void (async (): Promise<void> => {
    if (path === '/' || path === '') {
      // Redirect to /home
      replaceAppHistoryPath('/home');
      await loadHomePage(isRouteActive);
    } else if (path === '/home') {
      await loadHomePage(isRouteActive, scrollRestoreState);
    } else if (path === '/global') {
      await loadGlobalPage(isRouteActive, scrollRestoreState);
    } else if (path === '/notifications') {
      const homeButton: HTMLElement | null =
        document.getElementById('nav-home');
      const globalButton: HTMLElement | null =
        document.getElementById('nav-global');
      const relaysButton: HTMLElement | null =
        document.getElementById('nav-relays');
      const notificationsButton: HTMLElement | null =
        document.getElementById('nav-notifications');
      const profileLink: HTMLElement | null =
        document.getElementById('nav-profile');
      const settingsButton: HTMLElement | null =
        document.getElementById('nav-settings');
      setActiveNav(
        homeButton,
        globalButton,
        relaysButton,
        profileLink,
        settingsButton,
        null,
      );
      if (notificationsButton) {
        notificationsButton.classList.remove('text-gray-700');
        notificationsButton.classList.add('bg-indigo-100', 'text-indigo-700');
      }
      await Promise.resolve(
        loadNotificationsPage({ relays, limit: 50, isRouteActive }),
      );
    } else if (path === '/reactions') {
      const homeButton: HTMLElement | null =
        document.getElementById('nav-home');
      const globalButton: HTMLElement | null =
        document.getElementById('nav-global');
      const relaysButton: HTMLElement | null =
        document.getElementById('nav-relays');
      const notificationsButton: HTMLElement | null =
        document.getElementById('nav-notifications');
      const reactionsButton: HTMLElement | null =
        document.getElementById('nav-reactions');
      const profileLink: HTMLElement | null =
        document.getElementById('nav-profile');
      const settingsButton: HTMLElement | null =
        document.getElementById('nav-settings');
      setActiveNav(
        homeButton,
        globalButton,
        relaysButton,
        profileLink,
        settingsButton,
        null,
      );
      if (notificationsButton) {
        notificationsButton.classList.remove(
          'bg-indigo-100',
          'text-indigo-700',
        );
        notificationsButton.classList.add('text-gray-700');
      }
      if (reactionsButton) {
        reactionsButton.classList.remove('text-gray-700');
        reactionsButton.classList.add('bg-indigo-100', 'text-indigo-700');
      }
      await Promise.resolve(
        loadReactionsPage({ relays, limit: 100, isRouteActive }),
      );
    } else if (path === '/relays') {
      await Promise.resolve(
        loadRelaysPage({
          closeAllWebSockets,
          stopBackgroundFetch: (): void => {
            if (backgroundFetchInterval) {
              clearInterval(backgroundFetchInterval);
              backgroundFetchInterval = null;
            }
          },
          clearNotification: (): void => {
            const notification = document.getElementById(
              'new-posts-notification',
            );
            if (notification) {
              notification.remove();
            }
          },
          setActiveNav,
          getRelays: (): string[] => getAllRelays(),
          setRelays: (list: string[]): void => {
            setRelays(list);
            syncRelays();
          },
          normalizeRelayUrl,
          onRelaysChanged: syncRelays,
          onBroadcastRequested: async (): Promise<void> => {
            const statusEl: HTMLElement | null =
              document.getElementById('broadcast-status');
            const setStatus = (
              message: string,
              type: 'info' | 'error' | 'success' = 'info',
            ): void => {
              if (!statusEl) return;
              statusEl.textContent = message;
              if (type === 'error') {
                statusEl.className = 'text-xs text-red-600';
              } else if (type === 'success') {
                statusEl.className = 'text-xs text-emerald-700';
              } else {
                statusEl.className = 'text-xs text-gray-600';
              }
            };

            try {
              setStatus('Preparing broadcast...');
              const result = await broadcastRecentPosts({
                relays: getAllRelays(),
                limit: 50,
                onProgress: ({ total, completed }): void => {
                  setStatus(`Broadcasting ${completed}/${total} posts...`);
                },
              });
              setStatus(
                `Broadcasted ${result.completed} posts to ${result.relays} relays.`,
                'success',
              );

              const storedPubkey: string | null =
                localStorage.getItem('nostr_pubkey');
              if (storedPubkey) {
                await deleteTimeline('home', storedPubkey as PubkeyHex);
              }
              cachedHomeTimeline = null;
            } catch (error: unknown) {
              const message: string =
                error instanceof Error ? error.message : 'Broadcast failed.';
              setStatus(message, 'error');
            }
          },
          onNip65ImportRequested: importRelaysFromNip65,
          onNip65PublishRequested: publishRelaysToNip65,
          profileSection,
          output,
        }),
      );
    } else if (path === '/settings') {
      await Promise.resolve(
        loadSettingsPage({
          closeAllWebSockets,
          stopBackgroundFetch: (): void => {
            if (backgroundFetchInterval) {
              clearInterval(backgroundFetchInterval);
              backgroundFetchInterval = null;
            }
          },
          clearNotification: (): void => {
            const notification = document.getElementById(
              'new-posts-notification',
            );
            if (notification) {
              notification.remove();
            }
          },
          setActiveNav,
          profileSection,
          output,
        }),
      );
    } else if (path === '/about') {
      const notificationsButton: HTMLElement | null =
        document.getElementById('nav-notifications');
      if (notificationsButton) {
        notificationsButton.classList.remove(
          'bg-indigo-100',
          'text-indigo-700',
        );
        notificationsButton.classList.add('text-gray-700');
      }
      await Promise.resolve(
        loadAboutPage({
          closeAllWebSockets,
          stopBackgroundFetch: (): void => {
            if (backgroundFetchInterval) {
              clearInterval(backgroundFetchInterval);
              backgroundFetchInterval = null;
            }
          },
          clearNotification: (): void => {
            const notification = document.getElementById(
              'new-posts-notification',
            );
            if (notification) {
              notification.remove();
            }
          },
          setActiveNav,
          profileSection,
          output,
        }),
      );
    } else {
      // Try to parse as npub profile
      const npub: string = path.replace('/', '').trim();
      if (npub.startsWith('nevent') || npub.startsWith('note')) {
        await Promise.resolve(
          loadEventPage({
            eventRef: npub,
            relays,
            output,
            profileSection,
            closeAllWebSockets,
            stopBackgroundFetch: (): void => {
              if (backgroundFetchInterval) {
                clearInterval(backgroundFetchInterval);
                backgroundFetchInterval = null;
              }
            },
            clearNotification: (): void => {
              const notification = document.getElementById(
                'new-posts-notification',
              );
              if (notification) {
                notification.remove();
              }
            },
            isRouteActive,
          }),
        );
      } else if (isNip05Identifier(npub)) {
        // NIP-05 identifier (e.g., user@domain.com)
        closeAllWebSockets();
        if (backgroundFetchInterval) {
          clearInterval(backgroundFetchInterval);
          backgroundFetchInterval = null;
        }
        const notification = document.getElementById('new-posts-notification');
        if (notification) {
          notification.remove();
        }

        const homeButton: HTMLElement | null =
          document.getElementById('nav-home');
        const globalButton: HTMLElement | null =
          document.getElementById('nav-global');
        const relaysButton: HTMLElement | null =
          document.getElementById('nav-relays');
        const notificationsButton: HTMLElement | null =
          document.getElementById('nav-notifications');
        const profileLink: HTMLElement | null =
          document.getElementById('nav-profile');
        const settingsButton: HTMLElement | null =
          document.getElementById('nav-settings');
        setActiveNav(
          homeButton,
          globalButton,
          relaysButton,
          profileLink,
          settingsButton,
          profileLink,
        );
        if (notificationsButton) {
          notificationsButton.classList.remove(
            'bg-indigo-100',
            'text-indigo-700',
          );
          notificationsButton.classList.add('text-gray-700');
        }

        renderLoadingState('Resolving NIP-05 identifier...', npub);

        const pubkeyHex: PubkeyHex | null = await resolveNip05(npub);
        if (!isRouteActive()) return;
        if (pubkeyHex) {
          const resolvedNpub: string = nip19.npubEncode(pubkeyHex);
          await startApp(resolvedNpub as Npub, isRouteActive);
        } else if (output) {
          output.innerHTML = `
          <div class="text-center py-8">
            <p class="text-red-600 mb-4">Could not resolve NIP-05 identifier.</p>
            <p class="text-gray-600 text-sm">"${npub}" could not be found. Check the identifier and try again.</p>
          </div>
        `;
        }
      } else if (npub.startsWith('npub')) {
        // Close any active WebSocket connections from previous timeline
        // Note: Potential race condition if navigation happens quickly, but mitigated by
        // isRouteActive() guards that prevent new subscriptions from continuing after route change
        closeAllWebSockets();

        // Stop background fetching when switching away from home timeline
        if (backgroundFetchInterval) {
          clearInterval(backgroundFetchInterval);
          backgroundFetchInterval = null;
        }

        // Remove new posts notification if exists
        const notification = document.getElementById('new-posts-notification');
        if (notification) {
          notification.remove();
        }

        const homeButton: HTMLElement | null =
          document.getElementById('nav-home');
        const globalButton: HTMLElement | null =
          document.getElementById('nav-global');
        const relaysButton: HTMLElement | null =
          document.getElementById('nav-relays');
        const notificationsButton: HTMLElement | null =
          document.getElementById('nav-notifications');
        const profileLink: HTMLElement | null =
          document.getElementById('nav-profile');
        const settingsButton: HTMLElement | null =
          document.getElementById('nav-settings');
        setActiveNav(
          homeButton,
          globalButton,
          relaysButton,
          profileLink,
          settingsButton,
          profileLink,
        );
        if (notificationsButton) {
          notificationsButton.classList.remove(
            'bg-indigo-100',
            'text-indigo-700',
          );
          notificationsButton.classList.add('text-gray-700');
        }
        await startApp(npub, isRouteActive);
      } else {
        if (output) {
          output.innerHTML = "<p class='text-red-500'>Invalid URL format.</p>";
        }
      }
    }

    if (!isRouteActive()) {
      return;
    }
    if (scrollRestoreState !== undefined) {
      await restoreScrollFromState(scrollRestoreState);
    }
  })();
}

// Load home page
async function loadHomePage(
  isRouteActive: () => boolean,
  historyState?: unknown,
): Promise<void> {
  if (!isRouteActive()) {
    return;
  }
  // Close any active WebSocket connections from previous timeline
  closeAllWebSockets();

  const storedPubkey: string | null = localStorage.getItem('nostr_pubkey');

  // Set active navigation
  const homeButton: HTMLElement | null = document.getElementById('nav-home');
  const globalButton: HTMLElement | null =
    document.getElementById('nav-global');
  const notificationsButton: HTMLElement | null =
    document.getElementById('nav-notifications');
  const relaysButton: HTMLElement | null =
    document.getElementById('nav-relays');
  const profileLink: HTMLElement | null =
    document.getElementById('nav-profile');
  const settingsButton: HTMLElement | null =
    document.getElementById('nav-settings');
  setActiveNav(
    homeButton,
    globalButton,
    relaysButton,
    profileLink,
    settingsButton,
    homeButton,
  );
  if (notificationsButton) {
    notificationsButton.classList.remove('bg-indigo-100', 'text-indigo-700');
    notificationsButton.classList.add('text-gray-700');
  }

  // Update logout button visibility
  updateLogoutButton(composeButton);

  if (storedPubkey) {
    // User is logged in, load their home timeline
    const postsHeader: HTMLElement | null =
      document.getElementById('posts-header');
    if (postsHeader) {
      if (!isRouteActive()) return; // Guard before DOM update
      postsHeader.textContent = 'Home Timeline';
      postsHeader.style.display = '';
    }

    // Clear profile section
    if (profileSection) {
      if (!isRouteActive()) return; // Guard before DOM update
      profileSection.innerHTML = '';
      profileSection.className = '';
    }

    // If this navigation came from browser back/forward, restore the same
    // cached events first so scroll restoration lands on the same content.
    const restoreCount: number = getRestoreTimelineCount(historyState, 'home');
    if (restoreCount > 0) {
      const restored = await restoreTimelineFromCache({
        type: 'home',
        userPubkey: storedPubkey as PubkeyHex,
        desiredCount: restoreCount,
        isRouteActive,
      });
      if (restored.restored && isRouteActive()) {
        untilTimestamp =
          restored.oldestTimestamp || Math.floor(Date.now() / 1000);
        newestEventTimestamp =
          restored.newestTimestamp || Math.floor(Date.now() / 1000);

        if (
          !backgroundFetchInterval &&
          cachedHomeTimeline?.followedPubkeys?.length
        ) {
          startBackgroundFetch(
            cachedHomeTimeline.followedPubkeys as PubkeyHex[],
          );
        }
        return;
      }
    }

    // Check if we have a cached follow list
    if (cachedHomeTimeline && cachedHomeTimeline.followedPubkeys.length > 0) {
      // Use cached follow list, reload timeline
      console.log('Using cached follow list, reloading home timeline');

      if (!isRouteActive()) return; // Guard before DOM update
      renderLoadingState('Loading your timeline...');
      seenEventIds.clear();
      untilTimestamp = Math.floor(Date.now() / 1000);
      newestEventTimestamp = untilTimestamp;

      if (output) {
        await loadHomeTimeline(
          cachedHomeTimeline.followedPubkeys,
          homeKinds,
          relays,
          limit,
          untilTimestamp,
          seenEventIds,
          output,
          connectingMsg,
          activeWebSockets,
          activeTimeouts,
          isRouteActive,
          storedPubkey as PubkeyHex,
        );
      }
      if (!isRouteActive()) {
        return;
      }

      // Align background "since" cursor to newest cached timeline event.
      try {
        const newest: number = await getTimelineNewestTimestamp(
          'home',
          storedPubkey as PubkeyHex,
        );
        if (Number.isFinite(newest) && newest > 0) {
          newestEventTimestamp = newest;
        }
      } catch {
        // Best-effort only.
      }

      // Restart background fetching
      if (!backgroundFetchInterval) {
        startBackgroundFetch(cachedHomeTimeline.followedPubkeys);
      }
    } else {
      // No cache, load fresh timeline
      if (output) {
        output.innerHTML = '';
      }
      seenEventIds.clear();
      untilTimestamp = Math.floor(Date.now() / 1000);
      await loadUserHomeTimeline({
        pubkeyHex: storedPubkey as PubkeyHex,
        relays,
        output,
        profileSection,
        connectingMsg,
        homeKinds,
        limit,
        seenEventIds,
        activeWebSockets,
        activeTimeouts,
        setUntilTimestamp: (value: number): void => {
          untilTimestamp = value;
        },
        setNewestEventTimestamp: (value: number): void => {
          newestEventTimestamp = value;
        },
        setCachedHomeTimeline: (
          followedWithSelf: PubkeyHex[],
          seen: Set<string>,
        ): void => {
          cachedHomeTimeline = {
            events: Array.from(seen),
            followedPubkeys: followedWithSelf,
            timestamp: Date.now(),
          };
        },
        startBackgroundFetch,
        isRouteActive,
      });
      if (!isRouteActive()) {
        return;
      }

      // Align background "since" cursor to newest cached timeline event.
      try {
        const newest: number = await getTimelineNewestTimestamp(
          'home',
          storedPubkey as PubkeyHex,
        );
        if (Number.isFinite(newest) && newest > 0) {
          newestEventTimestamp = newest;
        }
      } catch {
        // Best-effort only.
      }
    }
  } else {
    // User not logged in, show welcome screen
    showInputForm({
      output,
      profileSection,
      composeButton,
      updateLogoutButton,
      clearSessionPrivateKey,
      setSessionPrivateKeyFromRaw,
      handleRoute,
    });
  }
}

// Load global page
async function loadGlobalPage(
  isRouteActive: () => boolean,
  historyState?: unknown,
): Promise<void> {
  if (!isRouteActive()) {
    return;
  }
  // Close any active WebSocket connections from previous timeline
  closeAllWebSockets();

  // Set active navigation
  const homeButton: HTMLElement | null = document.getElementById('nav-home');
  const globalButton: HTMLElement | null =
    document.getElementById('nav-global');
  const notificationsButton: HTMLElement | null =
    document.getElementById('nav-notifications');
  const relaysButton: HTMLElement | null =
    document.getElementById('nav-relays');
  const profileLink: HTMLElement | null =
    document.getElementById('nav-profile');
  const settingsButton: HTMLElement | null =
    document.getElementById('nav-settings');
  setActiveNav(
    homeButton,
    globalButton,
    relaysButton,
    profileLink,
    settingsButton,
    globalButton,
  );
  if (notificationsButton) {
    notificationsButton.classList.remove('bg-indigo-100', 'text-indigo-700');
    notificationsButton.classList.add('text-gray-700');
  }

  // Stop background fetching when switching away from home timeline
  if (backgroundFetchInterval) {
    clearInterval(backgroundFetchInterval);
    backgroundFetchInterval = null;
  }

  // Remove new posts notification if exists
  const notification = document.getElementById('new-posts-notification');
  if (notification) {
    notification.remove();
  }

  // Clear output and load global timeline
  if (!isRouteActive()) return; // Guard before DOM update
  renderLoadingState('Loading global timeline...');

  const postsHeader: HTMLElement | null =
    document.getElementById('posts-header');
  if (postsHeader) {
    if (!isRouteActive()) return; // Guard before DOM update
    postsHeader.textContent = 'Global Timeline';
    postsHeader.style.display = '';
  }

  // Clear profile section
  if (profileSection) {
    if (!isRouteActive()) return; // Guard before DOM update
    profileSection.innerHTML = '';
    profileSection.className = '';
  }

  seenEventIds.clear();
  untilTimestamp = Math.floor(Date.now() / 1000);
  const restoreCount: number = getRestoreTimelineCount(historyState, 'global');
  if (restoreCount > 0) {
    const restored = await restoreTimelineFromCache({
      type: 'global',
      desiredCount: restoreCount,
      isRouteActive,
    });
    if (restored.restored && isRouteActive()) {
      untilTimestamp =
        restored.oldestTimestamp || Math.floor(Date.now() / 1000);
      return;
    }
  }

  if (output) {
    await loadGlobalTimeline(
      relays,
      limit,
      untilTimestamp,
      seenEventIds,
      output,
      connectingMsg,
      activeWebSockets,
      activeTimeouts,
      isRouteActive,
    );
  }
}

async function startApp(
  npub: Npub,
  isRouteActive: () => boolean,
): Promise<void> {
  if (!isRouteActive()) {
    return;
  }

  renderLoadingState('Loading profile and posts...');
  console.log('[App] Starting profile load for', npub);

  let didTimeout: boolean = false;
  const isStillActive = (): boolean => isRouteActive() && !didTimeout;

  try {
    await Promise.race([
      startAppCore(npub, isStillActive),
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          didTimeout = true;
          reject(new Error('Profile loading timed out'));
        }, 15000);
      }),
    ]);
  } catch (error) {
    console.error('[App] Profile loading failed:', error);
    if (!isRouteActive()) return;
    if (output) {
      const message: string =
        error instanceof Error ? error.message : 'Unknown error';
      output.innerHTML = `
        <div class="text-center py-8">
          <p class="text-red-600 mb-4">Failed to load profile.</p>
          <p class="text-gray-600 text-sm">${message}</p>
          <button onclick="window.location.reload()" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">
            Retry
          </button>
        </div>
      `;
    }
  }
}

async function startAppCore(
  npub: Npub,
  isRouteActive: () => boolean,
): Promise<void> {
  if (!isRouteActive()) {
    return;
  }

  let pubkeyHex: PubkeyHex;
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub' || typeof decoded.data !== 'string') {
      throw new Error('Invalid npub address');
    }
    pubkeyHex = decoded.data;
  } catch (e) {
    if (output) {
      output.innerHTML =
        "<p class='text-red-500'>Failed to decode npub address.</p>";
    }
    throw e;
  }

  try {
    profile = await Promise.race([
      fetchProfile(pubkeyHex, relays),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 10000);
      }),
    ]);
    if (!profile) {
      console.warn('[App] Profile fetch timed out, continuing anyway');
    } else {
      console.log('[App] Profile fetched: success');
    }
  } catch (error) {
    console.error('[App] Profile fetch failed:', error);
    profile = null;
  }

  if (!isRouteActive()) {
    return;
  }
  if (profileSection) {
    if (!isRouteActive()) return; // Guard before DOM update
    renderProfile(pubkeyHex, npub, profile, profileSection);
  }

  try {
    await setupFollowToggle(pubkeyHex, {
      getRelays: (): string[] => relays,
      publishEvent: publishEventToRelays,
      onFollowListChanged: (): void => {
        cachedHomeTimeline = null;
      },
    });
    console.log('[App] Follow toggle setup complete');
  } catch (error) {
    console.error('[App] Follow toggle setup failed:', error);
  }
  if (!isRouteActive()) {
    return;
  }

  // Reset timestamp and seen events to fetch latest posts
  seenEventIds.clear();
  untilTimestamp = Math.floor(Date.now() / 1000);

  if (output) {
    try {
      console.log('[App] Events loading started');
      await loadEvents(
        pubkeyHex,
        profile,
        relays,
        limit,
        untilTimestamp,
        seenEventIds,
        output,
        connectingMsg,
        isRouteActive,
      );
    } catch (error) {
      console.error('[App] Events loading failed:', error);
      if (!isRouteActive()) return;
      if (output?.innerHTML.includes('Loading')) {
        output.innerHTML = `
          <div class="text-center py-8">
            <p class="text-red-600 mb-4">Failed to load posts.</p>
            <p class="text-gray-600 text-sm">The profile loaded, but posts could not be fetched.</p>
          </div>
        `;
      }
    }
  }
  if (!isRouteActive()) {
    return;
  }

  const postsHeader: HTMLElement | null =
    document.getElementById('posts-header');
  if (postsHeader) {
    if (!isRouteActive()) return; // Guard before DOM update
    postsHeader.textContent = 'Posts';
    postsHeader.style.display = '';
  }
}

function handleLogout(): void {
  localStorage.removeItem('nostr_pubkey');
  clearSessionPrivateKey();
  clearNotifications();

  cachedHomeTimeline = null;

  if (backgroundFetchInterval) {
    clearInterval(backgroundFetchInterval);
    backgroundFetchInterval = null;
  }

  const notification = document.getElementById('new-posts-notification');
  if (notification) {
    notification.remove();
  }

  updateLogoutButton(composeButton);
}

function startBackgroundFetch(followedPubkeys: PubkeyHex[]): void {
  // Clear existing interval if any
  if (backgroundFetchInterval) {
    clearInterval(backgroundFetchInterval);
  }

  // Fetch new posts every 30 seconds
  backgroundFetchInterval = window.setInterval(async () => {
    await fetchNewPosts(followedPubkeys);
  }, 30000);

  // Start service worker periodic sync
  const storedPubkey: string | null = localStorage.getItem('nostr_pubkey');
  if (storedPubkey) {
    startPeriodicSync({
      userPubkey: storedPubkey as PubkeyHex,
      followedPubkeys: followedPubkeys,
      syncGlobal: false, // Only sync home timeline for now
    }).catch((error: unknown): void => {
      console.error('[App] Failed to start periodic sync:', error);
    });
  }
}

async function fetchNewPosts(followedPubkeys: PubkeyHex[]): Promise<void> {
  if (!output || followedPubkeys.length === 0) return;

  const newEvents: any[] = [];
  // Nostr filter `since` is inclusive; +1 avoids repeatedly refetching the same newest timestamp.
  const since = newestEventTimestamp + 1;

  for (const relayUrl of relays) {
    try {
      const socket: WebSocket = createRelayWebSocket(relayUrl);

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          recordRelayFailure(relayUrl);
          socket.close();
          resolve();
        }, 5000);

        socket.onopen = (): void => {
          const subId: string = `new-${Math.random().toString(36).slice(2)}`;
          const req = [
            'REQ',
            subId,
            {
              kinds: homeKinds,
              authors: followedPubkeys,
              since: since,
              limit: 20,
            },
          ];
          socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === 'EVENT') {
            const event = arr[2];
            if (!seenEventIds.has(event.id)) {
              newEvents.push(event);
              if (event.created_at > newestEventTimestamp) {
                newestEventTimestamp = event.created_at;
              }
            }
          } else if (arr[0] === 'EOSE') {
            clearTimeout(timeout);
            socket.close();
            resolve();
          }
        };

        socket.onerror = (): void => {
          clearTimeout(timeout);
          socket.close();
          resolve();
        };
      });
    } catch (e) {
      console.warn(`Failed to fetch new posts from ${relayUrl}:`, e);
    }
  }

  if (newEvents.length > 0) {
    showNewPostsNotification(newEvents.length);
  }
}

function showNewPostsNotification(count: number): void {
  // Check if notification already exists
  let notification: HTMLElement | null = document.getElementById(
    'new-posts-notification',
  );

  if (!notification) {
    notification = document.createElement('div');
    notification.id = 'new-posts-notification';
    notification.className =
      'fixed top-20 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg cursor-pointer hover:bg-indigo-700 transition-colors z-50 animate-bounce';
    notification.innerHTML = `
      <span class="font-semibold">${count} new post${count > 1 ? 's' : ''} available</span>
      <span class="ml-2">↻ Click to refresh</span>
    `;

    notification.addEventListener('click', async () => {
      const storedPubkey = localStorage.getItem('nostr_pubkey');
      if (storedPubkey) {
        // Remove notification
        notification?.remove();
        // Reload timeline
        if (output) {
          output.innerHTML = '';
        }
        seenEventIds.clear();
        untilTimestamp = Math.floor(Date.now() / 1000);
        newestEventTimestamp = untilTimestamp;

        const followedPubkeys = cachedHomeTimeline?.followedPubkeys || [];
        if (followedPubkeys.length > 0 && output) {
          const isRouteActive = createRouteGuard();
          await loadHomeTimeline(
            followedPubkeys,
            homeKinds,
            relays,
            limit,
            untilTimestamp,
            seenEventIds,
            output,
            connectingMsg,
            activeWebSockets,
            activeTimeouts,
            isRouteActive,
            storedPubkey as PubkeyHex,
          );
        }
      }
    });

    document.body.appendChild(notification);
  } else {
    // Update existing notification
    notification.innerHTML = `
      <span class="font-semibold">${count} new post${count > 1 ? 's' : ''} available</span>
      <span class="ml-2">↻ Click to refresh</span>
    `;
  }
}
