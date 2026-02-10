import { nip19 } from "https://esm.sh/nostr-tools@2.17.0";
import { fetchProfile } from "./profile.js";
import { fetchEventById, isEventDeleted, renderEvent } from "./events.js";
import { setEventMeta } from "./meta.js";
import { setActiveNav } from "./navigation.js";
import { getAvatarURL, getDisplayName } from "./utils.js";
import type { NostrProfile, PubkeyHex, Npub } from "../types/nostr";

interface LoadEventPageOptions {
  eventRef: string;
  relays: string[];
  output: HTMLElement | null;
  profileSection: HTMLElement | null;
  closeAllWebSockets: () => void;
  stopBackgroundFetch: () => void;
  clearNotification: () => void;
}

export async function loadEventPage(options: LoadEventPageOptions): Promise<void> {
  options.closeAllWebSockets();
  options.stopBackgroundFetch();
  options.clearNotification();

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

  if (options.profileSection) {
    options.profileSection.innerHTML = "";
    options.profileSection.className = "";
  }

  if (options.output) {
    options.output.innerHTML = `
      <div class="text-center py-12">
        <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
        <p class="text-gray-700 font-semibold">Loading event...</p>
      </div>
    `;
  }

  try {
    const decoded = nip19.decode(options.eventRef);
    let eventId: string | undefined;
    let relayHints: string[] = [];
    if (decoded.type === "nevent") {
      const data: any = decoded.data;
      eventId = data?.id || (typeof data === "string" ? data : undefined);
      relayHints = Array.isArray(data?.relays) ? data.relays : [];
    } else if (decoded.type === "note") {
      eventId = typeof decoded.data === "string" ? decoded.data : undefined;
    } else {
      throw new Error("Invalid event format");
    }
    if (!eventId) {
      throw new Error("Missing event id");
    }

    const relaysToUse: string[] = relayHints.length > 0 ? relayHints : options.relays;
    const event = await fetchEventById(eventId, relaysToUse);

    if (!options.output) return;
    options.output.innerHTML = "";

    if (!event) {
      options.output.innerHTML = "<p class='text-red-500'>Event not found on the configured relays.</p>";
      return;
    }

    const npubStr: Npub = nip19.npubEncode(event.pubkey);
    setEventMeta(event, npubStr);
    // Render immediately to reduce perceived delay.
    renderEvent(event, null, npubStr, event.pubkey, options.output);

    // Run slow checks/metadata fetches in parallel after first paint.
    const [deleted, eventProfile] = await Promise.all([
      isEventDeleted(event.id, event.pubkey as PubkeyHex, relaysToUse),
      fetchProfile(event.pubkey, relaysToUse),
    ]);

    if (deleted) {
      options.output.innerHTML = "<p class='text-gray-600'>This event was deleted by the author.</p>";
      return;
    }

    if (eventProfile) {
      const eventCard: HTMLElement | null = options.output.querySelector(".event-container");
      const nameEl: HTMLElement | null = eventCard?.querySelector(".event-username") as HTMLElement | null;
      const avatarEl: HTMLImageElement | null = eventCard?.querySelector(".event-avatar") as HTMLImageElement | null;
      if (nameEl) {
        nameEl.textContent = `👤 ${getDisplayName(npubStr, eventProfile)}`;
      }
      if (avatarEl) {
        avatarEl.src = getAvatarURL(event.pubkey, eventProfile);
      }
    }
  } catch (error: unknown) {
    console.error("Failed to load nevent:", error);
    if (options.output) {
      options.output.innerHTML = "<p class='text-red-500'>Failed to load event.</p>";
    }
  }
}
