import { nip19 } from "https://esm.sh/nostr-tools@2.17.0";
import { fetchProfile, renderProfile } from "./profile.js";
import { loadEvents, loadGlobalTimeline, loadHomeTimeline } from "./events.js";
import { setupComposeOverlay } from "./compose.js";
import { setupImageOverlay } from "./overlays.js";
import { getRelays, setRelays, normalizeRelayUrl } from "./relays.js";
import { loadRelaysPage } from "./relays-page.js";
import { setupFollowToggle, publishEventToRelays } from "./follow.js";
import { setupSearchBar } from "./search.js";
import { setupNavigation, setActiveNav } from "./navigation.js";
import { clearSessionPrivateKey, getSessionPrivateKey, setSessionPrivateKeyFromRaw, updateLogoutButton } from "./session.js";
import { showInputForm } from "./welcome.js";
import { loadEventPage } from "./event-page.js";
import { loadUserHomeTimeline } from "./home-loader.js";
import type { NostrProfile, PubkeyHex, Npub } from "../types/nostr";

const output: HTMLElement | null = document.getElementById("nostr-output");
const profileSection: HTMLElement | null = document.getElementById("profile-section");
const composeButton: HTMLElement | null = document.getElementById("nav-compose");
const connectingMsg: HTMLElement | null = document.getElementById("connecting-msg");
let relays: string[] = getRelays();
const limit: number = 100;
let seenEventIds: Set<string> = new Set();
let untilTimestamp: number = Math.floor(Date.now() / 1000);
let profile: NostrProfile | null = null;
const homeKinds: number[] = [1, 2, 9, 11, 22, 28, 40, 70, 77];

// Cache for home timeline
let cachedHomeTimeline: { events: any[]; followedPubkeys: string[]; timestamp: number } | null = null;
let backgroundFetchInterval: number | null = null;
let newestEventTimestamp: number = Math.floor(Date.now() / 1000);

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

function syncRelays(): void {
  relays = getRelays();
}
document.addEventListener("DOMContentLoaded", (): void => {
  if (connectingMsg) {
    connectingMsg.style.display = "none"; // Hide connecting message by default
  }

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
      if (window.location.pathname === "/home") {
        await loadHomePage();
      } else if (window.location.pathname === "/global") {
        await loadGlobalPage();
      }
    },
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
  const path: string = window.location.pathname;

  if (path === "/" || path === "") {
    // Redirect to /home
    window.history.replaceState(null, "", "/home");
    loadHomePage();
  } else if (path === "/home") {
    loadHomePage();
  } else if (path === "/global") {
    loadGlobalPage();
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
      getRelays: (): string[] => relays,
      setRelays: (list: string[]): void => {
        setRelays(list);
        syncRelays();
      },
      normalizeRelayUrl,
      onRelaysChanged: syncRelays,
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
      });
    } else if (npub.startsWith("npub")) {
      const homeButton: HTMLElement | null = document.getElementById("nav-home");
      const globalButton: HTMLElement | null = document.getElementById("nav-global");
      const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
      const profileLink: HTMLElement | null = document.getElementById("nav-profile");
      setActiveNav(homeButton, globalButton, relaysButton, profileLink, profileLink);
      startApp(npub);
    } else {
      if (output) {
        output.innerHTML = "<p class='text-red-500'>Invalid URL format.</p>";
      }
    }
  }
}

// Load home page
async function loadHomePage(): Promise<void> {
  // Close any active WebSocket connections from previous timeline
  closeAllWebSockets();

  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");

  // Set active navigation
  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
  const profileLink: HTMLElement | null = document.getElementById("nav-profile");
  setActiveNav(homeButton, globalButton, relaysButton, profileLink, homeButton);

  // Update logout button visibility
  updateLogoutButton(composeButton);

  if (storedPubkey) {
    // User is logged in, load their home timeline
    const postsHeader: HTMLElement | null = document.getElementById("posts-header");
    if (postsHeader) {
      postsHeader.textContent = "Home Timeline";
      postsHeader.style.display = "";
    }

    // Clear profile section
    if (profileSection) {
      profileSection.innerHTML = "";
      profileSection.className = "";
    }

    // Check if we have a cached timeline
    if (cachedHomeTimeline && cachedHomeTimeline.followedPubkeys.length > 0) {
      // Use cached follow list, reload timeline
      console.log("Using cached follow list, reloading home timeline");

      renderLoadingState("Loading your timeline...");
      seenEventIds.clear();
      untilTimestamp = Math.floor(Date.now() / 1000);
      newestEventTimestamp = untilTimestamp;

      if (output) {
        await loadHomeTimeline(cachedHomeTimeline.followedPubkeys, homeKinds, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, activeWebSockets, activeTimeouts);
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
      });
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
async function loadGlobalPage(): Promise<void> {
  // Close any active WebSocket connections from previous timeline
  closeAllWebSockets();

  // Set active navigation
  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
  const profileLink: HTMLElement | null = document.getElementById("nav-profile");
  setActiveNav(homeButton, globalButton, relaysButton, profileLink, globalButton);

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
  renderLoadingState("Loading global timeline...");

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.textContent = "Global Timeline";
    postsHeader.style.display = "";
  }

  // Clear profile section
  if (profileSection) {
    profileSection.innerHTML = "";
    profileSection.className = "";
  }

  seenEventIds.clear();
  untilTimestamp = Math.floor(Date.now() / 1000);
  if (output) {
    await loadGlobalTimeline(relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, activeWebSockets, activeTimeouts);
  }
}

async function startApp(npub: Npub): Promise<void> {
  renderLoadingState("Loading profile and posts...");

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

  profile = await fetchProfile(pubkeyHex, relays);
  if (profileSection) {
    renderProfile(pubkeyHex, npub, profile, profileSection);
  }
  await setupFollowToggle(pubkeyHex, {
    getRelays: (): string[] => relays,
    publishEvent: publishEventToRelays,
    onFollowListChanged: (): void => {
      cachedHomeTimeline = null;
    },
  });
  if (output) {
    await loadEvents(pubkeyHex, profile, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg);
  }

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.style.display = "";
  }
}

function handleLogout(): void {
  localStorage.removeItem("nostr_pubkey");
  clearSessionPrivateKey();

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
}

async function fetchNewPosts(followedPubkeys: PubkeyHex[]): Promise<void> {
  if (!output || followedPubkeys.length === 0) return;

  const newEvents: any[] = [];
  const since = newestEventTimestamp;

  for (const relayUrl of relays) {
    try {
      const socket: WebSocket = new WebSocket(relayUrl);

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
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
          await loadHomeTimeline(followedPubkeys, homeKinds, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, activeWebSockets, activeTimeouts);
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
