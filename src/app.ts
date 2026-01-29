import { nip19 } from "https://esm.sh/nostr-tools@2.17.0";
import { fetchProfile, renderProfile } from "./profile";
import { loadEvents } from "./events";
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

function showInputForm(): void {
  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.style.display = "none";
  }
  if (loadMoreBtn) {
    loadMoreBtn.style.display = "none";
  }
  if (connectingMsg) {
    connectingMsg.remove();
  }

  if (profileSection) {
    profileSection.innerHTML = `
      <div class="flex flex-col items-center space-y-4">
        <h2 class="text-xl font-semibold">Enter a Nostr npub Address</h2>
        <input id="npub-input" type="text" placeholder="npub1..."
          class="border border-gray-300 rounded px-4 py-2 w-full max-w-md text-gray-700" />
        <button id="go-button" class="mt-2 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded">
          Go
        </button>
      </div>
    `;
  }

  const goButton: HTMLElement | null = document.getElementById("go-button");
  if (goButton) {
    goButton.addEventListener("click", (): void => {
      const npubInput: HTMLInputElement | null = document.getElementById("npub-input") as HTMLInputElement;
      if (npubInput) {
        const npub: string = npubInput.value.trim();
        if (npub.startsWith("npub")) {
          window.location.href = `/${npub}`;
        } else {
          alert("Please enter a valid npub address!");
        }
      }
    });
  }
}