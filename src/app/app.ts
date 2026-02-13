import { nip19 } from 'nostr-tools';
import { fetchProfile, renderProfile } from "../features/profile/profile.js";
import { loadGlobalTimeline } from "../features/global/global-timeline.js";
import { loadHomeTimeline } from "../features/home/home-timeline.js";
import { loadEvents } from "../features/profile/profile-events.js";
import { setupComposeOverlay } from "../common/compose.js";
import { setupReplyOverlay } from "../common/reply.js";
import { setupImageOverlay } from "../common/overlays.js";
import { getAllRelays, getRelays, setRelays, recordRelayFailure, normalizeRelayUrl } from "../features/relays/relays.js";
import { loadRelaysPage } from "../features/relays/relays-page.js";
import { broadcastRecentPosts } from "../features/broadcast/broadcast.js";
import { loadSettingsPage } from "../features/settings/settings-page.js";
import { setupFollowToggle, publishEventToRelays } from "../features/profile/follow.js";
import { setupSearchBar } from "../common/search.js";
import { isNip05Identifier, resolveNip05 } from "../common/nip05.js";
import { setupNavigation, setActiveNav } from "../common/navigation.js";
import { clearSessionPrivateKey, getSessionPrivateKey, setSessionPrivateKeyFromRaw, updateLogoutButton } from "../common/session.js";
import { clearNotifications, loadNotificationsPage } from "../features/notifications/notifications.js";
import { showInputForm } from "../features/home/welcome.js";
import { loadEventPage } from "../features/event/event-page.js";
import { loadUserHomeTimeline } from "../features/home/home-loader.js";
import { createRelayWebSocket } from "../common/relay-socket.js";
import { registerServiceWorker, startPeriodicSync } from "../common/sync/service-worker-manager.js";
import { deleteTimeline } from "../common/db/index.js";
import type { NostrProfile, PubkeyHex, Npub } from "../../types/nostr";

const output: HTMLElement | null = document.getElementById("nostr-output");
const profileSection: HTMLElement | null = document.getElementById("profile-section");
const composeButton: HTMLElement | null = document.getElementById("nav-compose");
const connectingMsg: HTMLElement | null = document.getElementById("connecting-msg");
let relays: string[] = getRelays();
const limit: number = 100;
let seenEventIds: Set<string> = new Set();
let untilTimestamp: number = Math.floor(Date.now() / 1000);
let profile: NostrProfile | null = null;
const homeKinds: number[] = [1, 2, 6, 9, 11, 16, 22, 28, 40, 70, 77];

// Cache for home timeline
let cachedHomeTimeline: { events: any[]; followedPubkeys: string[]; timestamp: number } | null = null;
let backgroundFetchInterval: number | null = null;
let newestEventTimestamp: number = Math.floor(Date.now() / 1000);
let activeRouteToken: number = 0;

// Track active WebSocket connections
let activeWebSockets: WebSocket[] = [];
// Track active timeouts
let activeTimeouts: number[] = [];

function renderLoadingState(message: string, subMessage: string = ""): void {
  if (!output) {
    return;
  }

  output.innerHTML = `
    <div class="text-center py-12">
      <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
      <p class="text-gray-700 font-semibold">${message}</p>
      ${subMessage ? `<p class="text-gray-500 text-sm mt-2">${subMessage}</p>` : ""}
    </div>
  `;
}

// Close all active WebSocket connections and clear timeouts
function closeAllWebSockets(): void {
  activeWebSockets.forEach((socket: WebSocket): void => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
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

function syncRelays(): void {
  relays = getRelays();
}

function showNewEventsNotification(timelineType: string, count: number): void {
  // Remove existing notification if any
  const existingNotification = document.getElementById("sw-new-events-notification");
  if (existingNotification) {
    existingNotification.remove();
  }

  // Create notification banner
  const notification = document.createElement("div");
  notification.id = "sw-new-events-notification";
  notification.className = "fixed top-16 left-1/2 transform -translate-x-1/2 z-50 bg-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 cursor-pointer hover:bg-indigo-700 transition-colors";
  notification.innerHTML = `
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
    </svg>
    <span>${count} new ${count === 1 ? 'post' : 'posts'} available</span>
    <button class="ml-2 text-sm underline">Refresh</button>
  `;

  notification.addEventListener("click", (): void => {
    // Reload the current timeline
    handleRoute();
    notification.remove();
  });

  document.body.appendChild(notification);

  // Auto-hide after 10 seconds
  setTimeout((): void => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 10000);
}
document.addEventListener("DOMContentLoaded", (): void => {
  window.addEventListener("relays-updated", syncRelays);
  if (connectingMsg) {
    connectingMsg.style.display = "none"; // Hide connecting message by default
  }

  // Register service worker for background sync
  registerServiceWorker().then((success: boolean): void => {
    if (success) {
      console.log("[App] Service worker registered successfully");
    }
  }).catch((error: unknown): void => {
    console.error("[App] Failed to register service worker:", error);
  });

  // Listen for new events from service worker
  window.addEventListener("sw-new-events", ((event: CustomEvent): void => {
    const { timelineType, count } = event.detail;
    console.log(`[App] Service worker found ${count} new events for ${timelineType} timeline`);

    // Show notification banner
    showNewEventsNotification(timelineType, count);
  }) as EventListener);

  // Setup search functionality
  setupSearchBar(output);

  // Setup navigation
  setupNavigation({
    handleRoute,
    onLogout: handleLogout,
  });

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
      if (window.location.pathname === "/home") {
        await loadHomePage(isRouteActive);
      } else if (window.location.pathname === "/global") {
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
      if (window.location.pathname === "/home") {
        await loadHomePage(isRouteActive);
      } else if (window.location.pathname === "/global") {
        await loadGlobalPage(isRouteActive);
      }
    },
  });

  document.addEventListener("click", (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const target: HTMLElement | null = event.target as HTMLElement | null;
    const anchor: HTMLAnchorElement | null = target ? target.closest("a") : null;
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
      return;
    }

    const href: string | null = anchor.getAttribute("href");
    if (!href || !href.startsWith("/")) {
      return;
    }

    const url: URL = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      return;
    }

    event.preventDefault();
    window.history.pushState(null, "", url.pathname);
    handleRoute();
  });

  // Handle initial route
  handleRoute();
});

// Cleanup background fetch on page unload
window.addEventListener("beforeunload", (): void => {
  if (backgroundFetchInterval) {
    clearInterval(backgroundFetchInterval);
  }
});

// Handle browser back/forward buttons
window.addEventListener("popstate", (): void => {
  handleRoute();
});

// Router function
function handleRoute(): void {
  const isRouteActive: () => boolean = createRouteGuard();
  const path: string = window.location.pathname;
  updateLogoutButton(composeButton);
  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
  const notificationsButton: HTMLElement | null = document.getElementById("nav-notifications");
  if (notificationsButton) {
    notificationsButton.style.display = storedPubkey ? "" : "none";
  }

  if (path === "/" || path === "") {
    // Redirect to /home
    window.history.replaceState(null, "", "/home");
    loadHomePage(isRouteActive);
  } else if (path === "/home") {
    loadHomePage(isRouteActive);
  } else if (path === "/global") {
    loadGlobalPage(isRouteActive);
  } else if (path === "/notifications") {
    const homeButton: HTMLElement | null = document.getElementById("nav-home");
    const globalButton: HTMLElement | null = document.getElementById("nav-global");
    const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
    const notificationsButton: HTMLElement | null = document.getElementById("nav-notifications");
    const profileLink: HTMLElement | null = document.getElementById("nav-profile");
    const settingsButton: HTMLElement | null = document.getElementById("nav-settings");
    setActiveNav(homeButton, globalButton, relaysButton, profileLink, settingsButton, null);
    if (notificationsButton) {
      notificationsButton.classList.remove("text-gray-700");
      notificationsButton.classList.add("bg-indigo-100", "text-indigo-700");
    }
    loadNotificationsPage({ relays, limit: 50, isRouteActive });
  } else if (path === "/relays") {
    loadRelaysPage({
      closeAllWebSockets,
      stopBackgroundFetch: (): void => {
        if (backgroundFetchInterval) {
          clearInterval(backgroundFetchInterval);
          backgroundFetchInterval = null;
        }
      },
      clearNotification: (): void => {
        const notification = document.getElementById("new-posts-notification");
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
        const statusEl: HTMLElement | null = document.getElementById("broadcast-status");
        const setStatus = (message: string, type: "info" | "error" | "success" = "info"): void => {
          if (!statusEl) return;
          statusEl.textContent = message;
          if (type === "error") {
            statusEl.className = "text-xs text-red-600";
          } else if (type === "success") {
            statusEl.className = "text-xs text-emerald-700";
          } else {
            statusEl.className = "text-xs text-gray-600";
          }
        };

        try {
          setStatus("Preparing broadcast...");
          const result = await broadcastRecentPosts({
            relays: getAllRelays(),
            limit: 50,
            onProgress: ({ total, completed }): void => {
              setStatus(`Broadcasting ${completed}/${total} posts...`);
            },
          });
          setStatus(`Broadcasted ${result.completed} posts to ${result.relays} relays.`, "success");

          const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
          if (storedPubkey) {
            await deleteTimeline("home", storedPubkey as PubkeyHex);
          }
          cachedHomeTimeline = null;
        } catch (error: unknown) {
          const message: string = error instanceof Error ? error.message : "Broadcast failed.";
          setStatus(message, "error");
        }
      },
      profileSection,
      output,
    });
  } else if (path === "/settings") {
    loadSettingsPage({
      closeAllWebSockets,
      stopBackgroundFetch: (): void => {
        if (backgroundFetchInterval) {
          clearInterval(backgroundFetchInterval);
          backgroundFetchInterval = null;
        }
      },
      clearNotification: (): void => {
        const notification = document.getElementById("new-posts-notification");
        if (notification) {
          notification.remove();
        }
      },
      setActiveNav,
      profileSection,
      output,
    });
  } else {
    // Try to parse as npub profile
    const npub: string = path.replace("/", "").trim();
    if (npub.startsWith("nevent") || npub.startsWith("note")) {
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
          const notification = document.getElementById("new-posts-notification");
          if (notification) {
            notification.remove();
          }
        },
        isRouteActive,
      });
    } else if (isNip05Identifier(npub)) {
      // NIP-05 identifier (e.g., user@domain.com)
      closeAllWebSockets();
      if (backgroundFetchInterval) {
        clearInterval(backgroundFetchInterval);
        backgroundFetchInterval = null;
      }
      const notification = document.getElementById("new-posts-notification");
      if (notification) {
        notification.remove();
      }

      const homeButton: HTMLElement | null = document.getElementById("nav-home");
      const globalButton: HTMLElement | null = document.getElementById("nav-global");
      const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
      const notificationsButton: HTMLElement | null = document.getElementById("nav-notifications");
      const profileLink: HTMLElement | null = document.getElementById("nav-profile");
      const settingsButton: HTMLElement | null = document.getElementById("nav-settings");
      setActiveNav(homeButton, globalButton, relaysButton, profileLink, settingsButton, profileLink);
      if (notificationsButton) {
        notificationsButton.classList.remove("bg-indigo-100", "text-indigo-700");
        notificationsButton.classList.add("text-gray-700");
      }

      renderLoadingState("Resolving NIP-05 identifier...", npub);

      resolveNip05(npub).then((pubkeyHex: PubkeyHex | null): void => {
        if (!isRouteActive()) return;
        if (pubkeyHex) {
          const resolvedNpub: string = nip19.npubEncode(pubkeyHex);
          startApp(resolvedNpub as Npub, isRouteActive);
        } else {
          if (output) {
            output.innerHTML = `
              <div class="text-center py-8">
                <p class="text-red-600 mb-4">Could not resolve NIP-05 identifier.</p>
                <p class="text-gray-600 text-sm">"${npub}" could not be found. Check the identifier and try again.</p>
              </div>
            `;
          }
        }
      });
    } else if (npub.startsWith("npub")) {
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
      const notification = document.getElementById("new-posts-notification");
      if (notification) {
        notification.remove();
      }

      const homeButton: HTMLElement | null = document.getElementById("nav-home");
      const globalButton: HTMLElement | null = document.getElementById("nav-global");
      const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
      const notificationsButton: HTMLElement | null = document.getElementById("nav-notifications");
    const profileLink: HTMLElement | null = document.getElementById("nav-profile");
    const settingsButton: HTMLElement | null = document.getElementById("nav-settings");
    setActiveNav(homeButton, globalButton, relaysButton, profileLink, settingsButton, profileLink);
      if (notificationsButton) {
        notificationsButton.classList.remove("bg-indigo-100", "text-indigo-700");
        notificationsButton.classList.add("text-gray-700");
      }
      startApp(npub, isRouteActive);
    } else {
      if (output) {
        output.innerHTML = "<p class='text-red-500'>Invalid URL format.</p>";
      }
    }
  }
}

// Load home page
async function loadHomePage(isRouteActive: () => boolean): Promise<void> {
  if (!isRouteActive()) {
    return;
  }
  // Close any active WebSocket connections from previous timeline
  closeAllWebSockets();

  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");

  // Set active navigation
  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const notificationsButton: HTMLElement | null = document.getElementById("nav-notifications");
  const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
  const profileLink: HTMLElement | null = document.getElementById("nav-profile");
  const settingsButton: HTMLElement | null = document.getElementById("nav-settings");
  setActiveNav(homeButton, globalButton, relaysButton, profileLink, settingsButton, homeButton);
  if (notificationsButton) {
    notificationsButton.classList.remove("bg-indigo-100", "text-indigo-700");
    notificationsButton.classList.add("text-gray-700");
  }

  // Update logout button visibility
  updateLogoutButton(composeButton);

  if (storedPubkey) {
    // User is logged in, load their home timeline
    const postsHeader: HTMLElement | null = document.getElementById("posts-header");
    if (postsHeader) {
      if (!isRouteActive()) return; // Guard before DOM update
      postsHeader.textContent = "Home Timeline";
      postsHeader.style.display = "";
    }

    // Clear profile section
    if (profileSection) {
      if (!isRouteActive()) return; // Guard before DOM update
      profileSection.innerHTML = "";
      profileSection.className = "";
    }

    // Check if we have a cached timeline
    if (cachedHomeTimeline && cachedHomeTimeline.followedPubkeys.length > 0) {
      // Use cached follow list, reload timeline
      console.log("Using cached follow list, reloading home timeline");

      if (!isRouteActive()) return; // Guard before DOM update
      renderLoadingState("Loading your timeline...");
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

      // Restart background fetching
      if (!backgroundFetchInterval) {
      startBackgroundFetch(cachedHomeTimeline.followedPubkeys);
      }
    } else {
      // No cache, load fresh timeline
      if (output) {
        output.innerHTML = "";
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
        setCachedHomeTimeline: (followedWithSelf: PubkeyHex[], seen: Set<string>): void => {
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
async function loadGlobalPage(isRouteActive: () => boolean): Promise<void> {
  if (!isRouteActive()) {
    return;
  }
  // Close any active WebSocket connections from previous timeline
  closeAllWebSockets();

  // Set active navigation
  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const notificationsButton: HTMLElement | null = document.getElementById("nav-notifications");
  const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
  const profileLink: HTMLElement | null = document.getElementById("nav-profile");
  const settingsButton: HTMLElement | null = document.getElementById("nav-settings");
  setActiveNav(homeButton, globalButton, relaysButton, profileLink, settingsButton, globalButton);
  if (notificationsButton) {
    notificationsButton.classList.remove("bg-indigo-100", "text-indigo-700");
    notificationsButton.classList.add("text-gray-700");
  }

  // Stop background fetching when switching away from home timeline
  if (backgroundFetchInterval) {
    clearInterval(backgroundFetchInterval);
    backgroundFetchInterval = null;
  }

  // Remove new posts notification if exists
  const notification = document.getElementById("new-posts-notification");
  if (notification) {
    notification.remove();
  }

  // Clear output and load global timeline
  if (!isRouteActive()) return; // Guard before DOM update
  renderLoadingState("Loading global timeline...");

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    if (!isRouteActive()) return; // Guard before DOM update
    postsHeader.textContent = "Global Timeline";
    postsHeader.style.display = "";
  }

  // Clear profile section
  if (profileSection) {
    if (!isRouteActive()) return; // Guard before DOM update
    profileSection.innerHTML = "";
    profileSection.className = "";
  }

  seenEventIds.clear();
  untilTimestamp = Math.floor(Date.now() / 1000);
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

async function startApp(npub: Npub, isRouteActive: () => boolean): Promise<void> {
  if (!isRouteActive()) {
    return;
  }

  renderLoadingState("Loading profile and posts...");
  console.log("[App] Starting profile load for", npub);

  let didTimeout: boolean = false;
  const isStillActive = (): boolean => isRouteActive() && !didTimeout;

  try {
    await Promise.race([
      startAppCore(npub, isStillActive),
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          didTimeout = true;
          reject(new Error("Profile loading timed out"));
        }, 15000);
      }),
    ]);
  } catch (error) {
    console.error("[App] Profile loading failed:", error);
    if (!isRouteActive()) return;
    if (output) {
      const message: string = error instanceof Error ? error.message : "Unknown error";
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

async function startAppCore(npub: Npub, isRouteActive: () => boolean): Promise<void> {
  if (!isRouteActive()) {
    return;
  }

  let pubkeyHex: PubkeyHex;
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== "npub" || typeof decoded.data !== "string") {
      throw new Error("Invalid npub address");
    }
    pubkeyHex = decoded.data;
  } catch (e) {
    if (output) {
      output.innerHTML = "<p class='text-red-500'>Failed to decode npub address.</p>";
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
      console.warn("[App] Profile fetch timed out, continuing anyway");
    } else {
      console.log("[App] Profile fetched: success");
    }
  } catch (error) {
    console.error("[App] Profile fetch failed:", error);
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
    console.log("[App] Follow toggle setup complete");
  } catch (error) {
    console.error("[App] Follow toggle setup failed:", error);
  }
  if (!isRouteActive()) {
    return;
  }

  // Reset timestamp and seen events to fetch latest posts
  seenEventIds.clear();
  untilTimestamp = Math.floor(Date.now() / 1000);

  if (output) {
    try {
      console.log("[App] Events loading started");
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
      console.error("[App] Events loading failed:", error);
      if (!isRouteActive()) return;
      if (output && output.innerHTML.includes("Loading")) {
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

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    if (!isRouteActive()) return; // Guard before DOM update
    postsHeader.textContent = "Posts";
    postsHeader.style.display = "";
  }
}

function handleLogout(): void {
  localStorage.removeItem("nostr_pubkey");
  clearSessionPrivateKey();
  clearNotifications();

  cachedHomeTimeline = null;

  if (backgroundFetchInterval) {
    clearInterval(backgroundFetchInterval);
    backgroundFetchInterval = null;
  }

  const notification = document.getElementById("new-posts-notification");
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
  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
  if (storedPubkey) {
    startPeriodicSync({
      userPubkey: storedPubkey as PubkeyHex,
      followedPubkeys: followedPubkeys,
      syncGlobal: false, // Only sync home timeline for now
    }).catch((error: unknown): void => {
      console.error("[App] Failed to start periodic sync:", error);
    });
  }
}

async function fetchNewPosts(followedPubkeys: PubkeyHex[]): Promise<void> {
  if (!output || followedPubkeys.length === 0) return;

  const newEvents: any[] = [];
  const since = newestEventTimestamp;

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
          const subId: string = 'new-' + Math.random().toString(36).slice(2);
          const req = [
            "REQ", subId,
            {
              kinds: homeKinds,
              authors: followedPubkeys,
              since: since,
              limit: 20
            }
          ];
          socket.send(JSON.stringify(req));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === "EVENT") {
            const event = arr[2];
            if (!seenEventIds.has(event.id)) {
              newEvents.push(event);
              if (event.created_at > newestEventTimestamp) {
                newestEventTimestamp = event.created_at;
              }
            }
          } else if (arr[0] === "EOSE") {
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
  let notification: HTMLElement | null = document.getElementById("new-posts-notification");

  if (!notification) {
    notification = document.createElement("div");
    notification.id = "new-posts-notification";
    notification.className = "fixed top-20 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg cursor-pointer hover:bg-indigo-700 transition-colors z-50 animate-bounce";
    notification.innerHTML = `
      <span class="font-semibold">${count} new post${count > 1 ? 's' : ''} available</span>
      <span class="ml-2">↻ Click to refresh</span>
    `;

    notification.addEventListener("click", async () => {
      const storedPubkey = localStorage.getItem("nostr_pubkey");
      if (storedPubkey) {
        // Remove notification
        notification?.remove();
        // Reload timeline
        if (output) {
          output.innerHTML = "";
        }
        seenEventIds.clear();
        untilTimestamp = Math.floor(Date.now() / 1000);
        newestEventTimestamp = untilTimestamp;

        const followedPubkeys = cachedHomeTimeline?.followedPubkeys || [];
        if (followedPubkeys.length > 0 && output) {
          const isRouteActive = createRouteGuard();
          await loadHomeTimeline(followedPubkeys, homeKinds, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, activeWebSockets, activeTimeouts, isRouteActive, storedPubkey as PubkeyHex);
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
