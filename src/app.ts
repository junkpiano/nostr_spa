import { nip19 } from "https://esm.sh/nostr-tools@2.17.0";
import { fetchProfile, renderProfile } from "./profile.js";
import { loadEvents, loadGlobalTimeline, fetchFollowList, loadHomeTimeline } from "./events.js";
import type { NostrProfile, PubkeyHex, Npub } from "../types/nostr";

const output: HTMLElement | null = document.getElementById("nostr-output");
const profileSection: HTMLElement | null = document.getElementById("profile-section");
const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");
const connectingMsg: HTMLElement | null = document.getElementById("connecting-msg");
const relays: string[] = ["wss://relay.snort.social",
                "wss://relay.damus.io",
                "wss://relay.primal.net",
                "wss://nostr.wine",
                "wss://nos.lol",
                "wss://relay.nostr.band",
                "wss://purplepag.es",
                "wss://relay.nostr.wirednet.jp"];
const limit: number = 100;
let seenEventIds: Set<string> = new Set();
let untilTimestamp: number = Math.floor(Date.now() / 1000);
let profile: NostrProfile | null = null;

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

document.addEventListener("DOMContentLoaded", (): void => {
  if (connectingMsg) {
    connectingMsg.style.display = "none"; // Hide connecting message by default
  }

  // Setup search functionality
  setupSearchBar();

  // Setup navigation
  setupNavigation();

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
  } else {
    // Try to parse as npub profile
    const npub: string = path.replace("/", "").trim();
    if (npub.startsWith("npub")) {
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
  setActiveNav(homeButton, globalButton, homeButton);

  // Update logout button visibility
  updateLogoutButton();

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
        await loadHomeTimeline(cachedHomeTimeline.followedPubkeys, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, activeWebSockets, activeTimeouts);
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
  setActiveNav(homeButton, globalButton, globalButton);

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

async function startApp(npub: Npub): Promise<void> {
  let pubkeyHex: PubkeyHex;
  try {
    const decoded = nip19.decode(npub);
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
  if (output) {
    await loadEvents(pubkeyHex, profile, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg);
  }

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.style.display = "";
  }
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
        <p class="text-gray-600 mb-6">Connect your Nostr extension to view your home timeline,<br/>or explore the global timeline.</p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button id="welcome-login" class="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-lg">
            🔑 Connect Extension
          </button>
          <button id="welcome-global" class="bg-gradient-to-r from-slate-800 via-indigo-900 to-purple-950 hover:from-slate-900 hover:via-indigo-950 hover:to-purple-950 text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-lg">
            🌍 View Global Timeline
          </button>
        </div>
      </div>
    `;

    // Add event listeners to welcome buttons
    const welcomeLoginBtn: HTMLElement | null = document.getElementById("welcome-login");
    const welcomeGlobalBtn: HTMLElement | null = document.getElementById("welcome-global");

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

          // Update logout button visibility
          updateLogoutButton();

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
  }
}

function setupSearchBar(): void {
  const searchButton: HTMLElement | null = document.getElementById("search-button");
  const clearSearchButton: HTMLElement | null = document.getElementById("clear-search-button");
  const searchInput: HTMLInputElement | null = document.getElementById("search-input") as HTMLInputElement;

  function performSearch(): void {
    if (searchInput && output) {
      const query: string = searchInput.value.trim().toLowerCase();
      if (!query) {
        clearSearch();
        return;
      }

      // Get all event containers
      const eventContainers: NodeListOf<HTMLElement> = output.querySelectorAll(".event-container");
      let matchCount: number = 0;

      eventContainers.forEach((container: HTMLElement): void => {
        const contentDiv: HTMLElement | null = container.querySelector(".whitespace-pre-wrap");
        if (contentDiv) {
          const content: string = contentDiv.textContent?.toLowerCase() || "";
          if (content.includes(query)) {
            container.style.display = "";
            matchCount++;
          } else {
            container.style.display = "none";
          }
        }
      });

      // Show clear button when search is active
      if (clearSearchButton) {
        clearSearchButton.style.display = "";
      }

      // Update header to show search results count
      const postsHeader: HTMLElement | null = document.getElementById("posts-header");
      if (postsHeader) {
        postsHeader.textContent = `Search Results (${matchCount})`;
      }
    }
  }

  function clearSearch(): void {
    if (searchInput) {
      searchInput.value = "";
    }

    if (output) {
      // Show all event containers
      const eventContainers: NodeListOf<HTMLElement> = output.querySelectorAll(".event-container");
      eventContainers.forEach((container: HTMLElement): void => {
        container.style.display = "";
      });
    }

    // Hide clear button
    if (clearSearchButton) {
      clearSearchButton.style.display = "none";
    }

    // Reset header text
    const postsHeader: HTMLElement | null = document.getElementById("posts-header");
    if (postsHeader) {
      const path: string = window.location.pathname;
      if (path === "/global") {
        postsHeader.textContent = "Global Timeline";
      } else if (path === "/home") {
        postsHeader.textContent = "Home Timeline";
      } else {
        postsHeader.textContent = "Posts:";
      }
    }
  }

  if (searchButton) {
    searchButton.addEventListener("click", performSearch);
  }

  if (clearSearchButton) {
    clearSearchButton.addEventListener("click", clearSearch);
  }

  if (searchInput) {
    searchInput.addEventListener("keypress", (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        performSearch();
      }
    });

    // Real-time search as user types
    searchInput.addEventListener("input", (): void => {
      const query: string = searchInput.value.trim();
      if (query === "") {
        clearSearch();
      }
    });
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

    // Fetch follow list
    const followedPubkeys: PubkeyHex[] = await fetchFollowList(pubkeyHex, relays);

    // Update loading message
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
      await loadHomeTimeline(followedPubkeys, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, activeWebSockets, activeTimeouts);

      // Cache the timeline
      cachedHomeTimeline = {
        events: Array.from(seenEventIds),
        followedPubkeys: followedPubkeys,
        timestamp: Date.now()
      };

      // Start background fetching for new posts
      startBackgroundFetch(followedPubkeys);
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
              kinds: [1],
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
          await loadHomeTimeline(followedPubkeys, relays, limit, untilTimestamp, seenEventIds, output, connectingMsg, activeWebSockets, activeTimeouts);
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

// Set active navigation button
function setActiveNav(homeButton: HTMLElement | null, globalButton: HTMLElement | null, activeButton: HTMLElement | null): void {
  // Remove active state from all buttons
  if (homeButton) {
    homeButton.classList.remove("bg-indigo-100", "text-indigo-700");
    homeButton.classList.add("text-gray-700");
  }
  if (globalButton) {
    globalButton.classList.remove("bg-indigo-100", "text-indigo-700");
    globalButton.classList.add("text-gray-700");
  }

  // Add active state to the clicked button
  if (activeButton) {
    activeButton.classList.remove("text-gray-700");
    activeButton.classList.add("bg-indigo-100", "text-indigo-700");
  }
}

// Update logout button visibility based on login state
function updateLogoutButton(): void {
  const logoutButton: HTMLElement | null = document.getElementById("nav-logout");
  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");

  if (logoutButton) {
    if (storedPubkey) {
      logoutButton.style.display = "";
    } else {
      logoutButton.style.display = "none";
    }
  }
}

function setupNavigation(): void {
  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const logoutButton: HTMLElement | null = document.getElementById("nav-logout");

  if (homeButton) {
    homeButton.addEventListener("click", (): void => {
      window.history.pushState(null, "", "/home");
      handleRoute();
    });
  }

  if (globalButton) {
    globalButton.addEventListener("click", (): void => {
      window.history.pushState(null, "", "/global");
      handleRoute();
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", (): void => {
      // Clear login session
      localStorage.removeItem("nostr_pubkey");

      // Clear cache
      cachedHomeTimeline = null;

      // Stop background fetching
      if (backgroundFetchInterval) {
        clearInterval(backgroundFetchInterval);
        backgroundFetchInterval = null;
      }

      // Remove new posts notification
      const notification = document.getElementById("new-posts-notification");
      if (notification) {
        notification.remove();
      }

      // Update logout button visibility
      updateLogoutButton();

      // Navigate to home (will show welcome screen since not logged in)
      window.history.pushState(null, "", "/home");
      handleRoute();
    });
  }

  // Initial update of logout button
  updateLogoutButton();
}

