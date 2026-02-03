import { nip19 } from "https://esm.sh/nostr-tools@2.17.0";
import { fetchProfile, renderProfile } from "./profile.js";
import { loadEvents, loadGlobalTimeline } from "./events.js";
import type { NostrProfile, PubkeyHex, Npub } from "../types/nostr";

const output: HTMLElement | null = document.getElementById("nostr-output");
const profileSection: HTMLElement | null = document.getElementById("profile-section");
const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");
const connectingMsg: HTMLElement | null = document.getElementById("connecting-msg");
const relays: string[] = ["wss://nos.lol",
                "wss://relay.nostr.band",
                "wss://relay.damus.io",
                "wss://nostr.wine",
                "wss://relay.snort.social"];
const limit: number = 100;
let seenEventIds: Set<string> = new Set();
let untilTimestamp: number = Math.floor(Date.now() / 1000);
let profile: NostrProfile | null = null;

// Parse npub from URL
const path: string = window.location.pathname;
const npub: string = path.replace("/", "").trim();

document.addEventListener("DOMContentLoaded", (): void => {
  if (connectingMsg) {
    connectingMsg.style.display = "none"; // Hide connecting message by default
  }

  // Setup search functionality
  setupSearchBar();
});

if (npub === "") {
  showInputForm();
} else if (npub.startsWith("npub")) {
  startApp(npub);
} else {
  if (output) {
    output.innerHTML = "<p class='text-red-500'>Invalid URL format. Please input a valid npub address.</p>";
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
    postsHeader.textContent = "Global Timeline";
    postsHeader.style.display = "";
  }

  if (profileSection) {
    profileSection.innerHTML = "";
    profileSection.className = ""; // Remove all spacing classes
  }

  if (output) {
    await loadGlobalTimeline(relays, limit, untilTimestamp, seenEventIds, output, connectingMsg);
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
      if (npub === "") {
        postsHeader.textContent = "Global Timeline";
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