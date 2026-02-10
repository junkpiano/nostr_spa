import { nip19 } from "https://esm.sh/nostr-tools@2.17.0";
import { fetchProfile, renderProfile } from "./profile.js";
import { loadEvents, loadGlobalTimeline, fetchFollowList, loadHomeTimeline, fetchEventById, renderEvent } from "./events.js";
import { setupComposeOverlay } from "./compose.js";
import { setupImageOverlay } from "./overlays.js";
import { setEventMeta } from "./meta.js";
import { getRelays, setRelays, normalizeRelayUrl } from "./relays.js";
import { loadRelaysPage } from "./relays-page.js";
import { setupFollowToggle, publishEventToRelays } from "./follow.js";
import { setupSearchBar } from "./search.js";
import { setupNavigation, setActiveNav } from "./navigation.js";
import { clearSessionPrivateKey, getSessionPrivateKey, setSessionPrivateKeyFromRaw, updateLogoutButton } from "./session.js";
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
const homeKinds: number[] = [1, 2, 4, 9, 11, 22, 28, 40, 70, 77];

// Cache for home timeline
let cachedHomeTimeline: { events: any[]; followedPubkeys: string[]; timestamp: number } | null = null;
let backgroundFetchInterval: number | null = null;
let newestEventTimestamp: number = Math.floor(Date.now() / 1000);

// Track active WebSocket connections
let activeWebSockets: WebSocket[] = [];
// Track active timeouts
let activeTimeouts: number[] = [];

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
    if (npub.startsWith("nevent")) {
      loadEventPage(npub);
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

      if (output) {
        output.innerHTML = "";
      }
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
      await loadUserHomeTimeline(storedPubkey);
    }
  } else {
    // User not logged in, show welcome screen
    showInputForm();
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
  if (output) {
    output.innerHTML = "";
  }

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

async function loadEventPage(nevent: string): Promise<void> {
  // Close any active WebSocket connections from previous timeline
  closeAllWebSockets();

  // Stop background fetching when switching away from timelines
  if (backgroundFetchInterval) {
    clearInterval(backgroundFetchInterval);
    backgroundFetchInterval = null;
  }

  // Remove new posts notification if exists
  const notification = document.getElementById("new-posts-notification");
  if (notification) {
    notification.remove();
  }

  // Clear navigation highlight for event view
  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
  const profileLink: HTMLElement | null = document.getElementById("nav-profile");
  setActiveNav(homeButton, globalButton, relaysButton, profileLink, null);

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.textContent = "Event";
    postsHeader.style.display = "";
  }

  if (profileSection) {
    profileSection.innerHTML = "";
    profileSection.className = "";
  }

  if (output) {
    output.innerHTML = `
      <div class="text-center py-12">
        <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
        <p class="text-gray-700 font-semibold">Loading event...</p>
      </div>
    `;
  }

  try {
    const decoded = nip19.decode(nevent);
    if (decoded.type !== "nevent") {
      throw new Error("Invalid nevent format");
    }
    const data: any = decoded.data;
    const eventId: string | undefined = data?.id || (typeof data === "string" ? data : undefined);
    const relayHints: string[] = Array.isArray(data?.relays) ? data.relays : [];

    if (!eventId) {
      throw new Error("Missing event id");
    }

    const relaysToUse: string[] = relayHints.length > 0 ? relayHints : relays;
    const event = await fetchEventById(eventId, relaysToUse);

    if (!output) return;
    output.innerHTML = "";

    if (!event) {
      output.innerHTML = "<p class='text-red-500'>Event not found on the configured relays.</p>";
      return;
    }

    const eventProfile: NostrProfile | null = await fetchProfile(event.pubkey, relaysToUse);
    const npubStr: Npub = nip19.npubEncode(event.pubkey);
    setEventMeta(event, npubStr);
    renderEvent(event, eventProfile, npubStr, event.pubkey, output);
  } catch (error: unknown) {
    console.error("Failed to load nevent:", error);
    if (output) {
      output.innerHTML = "<p class='text-red-500'>Failed to load event.</p>";
    }
  }
}

async function startApp(npub: Npub): Promise<void> {
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

async function showInputForm(): Promise<void> {
  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.style.display = "none";
  }

  if (profileSection) {
    profileSection.innerHTML = "";
    profileSection.className = ""; // Remove all spacing classes
  }

  if (output) {
    output.innerHTML = `
      <div class="text-center py-12">
        <h2 class="text-2xl font-bold text-gray-800 mb-4">Welcome to noxtr</h2>
        <p class="text-gray-600 mb-6">Connect your Nostr extension or use your private key to view your home timeline,<br/>or explore the global timeline.</p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button id="welcome-login" class="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-lg">
            🔑 Connect Extension
          </button>
          <button id="welcome-global" class="bg-gradient-to-r from-slate-800 via-indigo-900 to-purple-950 hover:from-slate-900 hover:via-indigo-950 hover:to-purple-950 text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-lg">
            🌍 View Global Timeline
          </button>
        </div>
        <div class="mt-6 max-w-xl mx-auto text-left space-y-2">
          <label for="private-key-input" class="block text-sm font-semibold text-gray-700">Private Key (nsec or 64 hex)</label>
          <div class="flex flex-col sm:flex-row gap-2">
            <input id="private-key-input" type="password" autocomplete="off" placeholder="nsec1... or hex"
              class="border border-gray-300 rounded-lg px-4 py-2 w-full text-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button id="private-key-login"
              class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow-lg">
              Use Private Key
            </button>
          </div>
          <p class="text-xs text-gray-500">Private keys are not stored. We only derive your public key locally.</p>
        </div>
      </div>
    `;

    // Add event listeners to welcome buttons
    const welcomeLoginBtn: HTMLElement | null = document.getElementById("welcome-login");
    const welcomeGlobalBtn: HTMLElement | null = document.getElementById("welcome-global");
    const privateKeyLoginBtn: HTMLElement | null = document.getElementById("private-key-login");
    const privateKeyInput: HTMLInputElement | null = document.getElementById("private-key-input") as HTMLInputElement;

    if (welcomeLoginBtn) {
      welcomeLoginBtn.addEventListener("click", async (): Promise<void> => {
        try {
          // Check if window.nostr is available (NIP-07)
          if (!(window as any).nostr) {
            alert("No Nostr extension found!\n\nPlease install a Nostr browser extension like:\n- Alby (getalby.com)\n- nos2x\n- Flamingo\n\nThen reload this page.");
            return;
          }

          // Get public key from extension
          const pubkeyHex: string = await (window as any).nostr.getPublicKey();

          if (!pubkeyHex) {
            alert("Failed to get public key from extension.");
            return;
          }

          // Store pubkey in localStorage
          localStorage.setItem("nostr_pubkey", pubkeyHex);
          clearSessionPrivateKey();

          // Update logout button visibility
          updateLogoutButton(composeButton);

          // Navigate to home
          window.history.pushState(null, "", "/home");
          handleRoute();
        } catch (error: unknown) {
          console.error("Extension login error:", error);
          if (error instanceof Error) {
            alert(`Failed to connect with extension: ${error.message}`);
          } else {
            alert("Failed to connect with extension. Please make sure your extension is unlocked and try again.");
          }
        }
      });
    }

    if (welcomeGlobalBtn) {
      welcomeGlobalBtn.addEventListener("click", (): void => {
        window.history.pushState(null, "", "/global");
        handleRoute();
      });
    }

    if (privateKeyLoginBtn) {
      privateKeyLoginBtn.addEventListener("click", (): void => {
        try {
          if (!privateKeyInput) return;
          const rawKey: string = privateKeyInput.value.trim();
          if (!rawKey) {
            alert("Please enter your private key.");
            return;
          }
          const pubkeyHex: PubkeyHex = setSessionPrivateKeyFromRaw(rawKey);
          localStorage.setItem("nostr_pubkey", pubkeyHex);
          privateKeyInput.value = "";
          updateLogoutButton(composeButton);
          window.history.pushState(null, "", "/home");
          handleRoute();
        } catch (error: unknown) {
          console.error("Private key login error:", error);
          clearSessionPrivateKey();
          if (error instanceof Error) {
            alert(`Failed to use private key: ${error.message}`);
          } else {
            alert("Failed to use private key.");
          }
        }
      });
    }

    if (privateKeyInput) {
      privateKeyInput.addEventListener("keypress", (e: KeyboardEvent): void => {
        if (e.key === "Enter" && privateKeyLoginBtn) {
          privateKeyLoginBtn.click();
        }
      });
    }
  }
}

async function loadUserHomeTimeline(pubkeyHex: PubkeyHex): Promise<void> {
  try {
    // Show loading state
    if (output) {
      output.innerHTML = `
        <div class="text-center py-12">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p class="text-gray-700 font-semibold">Fetching your follow list...</p>
          <p class="text-gray-500 text-sm mt-2">This may take a few seconds</p>
        </div>
      `;
    }

    // Update header
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

    // Fetch follow list (kind 3) from relays
    const followedPubkeys: PubkeyHex[] = await fetchFollowList(pubkeyHex, relays);
    const followedWithSelf: PubkeyHex[] = Array.from(new Set([...followedPubkeys, pubkeyHex]));

    if (output) {
      output.innerHTML = `
        <div class="text-center py-12">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p class="text-gray-700 font-semibold">Loading posts from ${followedPubkeys.length} people...</p>
        </div>
      `;
    }

    // Clear output before loading timeline
    if (output) {
      output.innerHTML = "";
    }

    // Load home timeline
    if (output) {
      seenEventIds.clear();
      untilTimestamp = Math.floor(Date.now() / 1000);
      newestEventTimestamp = untilTimestamp;
      await loadHomeTimeline(followedWithSelf, homeKinds, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, activeWebSockets, activeTimeouts);

      // Cache the timeline
      cachedHomeTimeline = {
        events: Array.from(seenEventIds),
        followedPubkeys: followedWithSelf,
        timestamp: Date.now()
      };

      // Start background fetching for new posts
      startBackgroundFetch(followedWithSelf);
    }
  } catch (error: unknown) {
    console.error("Error loading home timeline:", error);
    // Clear stored session on error
    localStorage.removeItem("nostr_pubkey");

    if (output) {
      output.innerHTML = `
        <div class="text-center py-8">
          <p class="text-red-600 mb-4">Failed to load home timeline.</p>
          <p class="text-gray-600 text-sm mb-4">Please try connecting your extension again.</p>
        </div>
      `;
    }
    throw error;
  }
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
