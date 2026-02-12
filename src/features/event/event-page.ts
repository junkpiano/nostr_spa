import { nip19 } from 'nostr-tools';
import { fetchProfile } from "../profile/profile.js";
import { fetchEventById, fetchRepliesForEvent, isEventDeleted } from "../../common/events-queries.js";
import { loadReactionsForEvent, renderEvent } from "../../common/event-render.js";
import { setEventMeta } from "../../common/meta.js";
import { setActiveNav } from "../../common/navigation.js";
import { getAvatarURL, getDisplayName } from "../../utils/utils.js";
import { getProfile as getCachedProfile, getEvent as getCachedEvent } from "../../common/db/index.js";
import type { NostrEvent, NostrProfile, PubkeyHex, Npub } from "../../../types/nostr";

interface LoadEventPageOptions {
  eventRef: string;
  relays: string[];
  output: HTMLElement | null;
  profileSection: HTMLElement | null;
  closeAllWebSockets: () => void;
  stopBackgroundFetch: () => void;
  clearNotification: () => void;
  isRouteActive?: () => boolean;
}

export async function loadEventPage(options: LoadEventPageOptions): Promise<void> {
  const isRouteActive: () => boolean = options.isRouteActive || (() => true);
  if (!isRouteActive()) {
    return;
  }
  options.closeAllWebSockets();
  options.stopBackgroundFetch();
  options.clearNotification();

  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
  const profileLink: HTMLElement | null = document.getElementById("nav-profile");
  const settingsButton: HTMLElement | null = document.getElementById("nav-settings");
  setActiveNav(homeButton, globalButton, relaysButton, profileLink, settingsButton, null);

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.textContent = "Event";
    postsHeader.style.display = "";
  }

  if (options.profileSection) {
    options.profileSection.innerHTML = "";
    options.profileSection.className = "";
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

    // Try to load event from IndexedDB cache first
    let event: NostrEvent | null = await getCachedEvent(eventId);
    let fromCache = !!event;

    // Only show loading spinner if not in cache
    if (!event && options.output) {
      if (!isRouteActive()) return; // Guard before DOM update
      options.output.innerHTML = `
        <div class="text-center py-12">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p class="text-gray-700 font-semibold">Loading event...</p>
        </div>
      `;
    }

    // If not in cache, fetch from relays
    if (!event) {
      event = await fetchEventById(eventId, relaysToUse);
    }

    if (!isRouteActive()) {
      return;
    }

    if (!options.output) return;
    if (!isRouteActive()) return; // Guard before DOM update
    options.output.innerHTML = "";

    if (!event) {
      if (!isRouteActive()) return; // Guard before DOM update
      options.output.innerHTML = "<p class='text-red-500'>Event not found on the configured relays.</p>";
      return;
    }

    const npubStr: Npub = nip19.npubEncode(event.pubkey);
    setEventMeta(event, npubStr);

    // Try to get profile from IndexedDB cache first for instant render
    const cachedProfile: NostrProfile | null = await getCachedProfile(event.pubkey);
    if (!isRouteActive()) return; // Guard before render
    renderEvent(event, cachedProfile, npubStr, event.pubkey, options.output);

    // Start loading reactions immediately in parallel (don't wait)
    const reactionsContainer: HTMLElement | null = options.output.querySelector(".reactions-container");
    const reactionsPromise = reactionsContainer
      ? loadReactionsForEvent(event.id, event.pubkey as PubkeyHex, reactionsContainer)
      : Promise.resolve();

    // Run slow checks/metadata fetches in parallel after first paint.
    // Always fetch profile from relays to get latest version
    const [deleted, eventProfile] = await Promise.all([
      isEventDeleted(event.id, event.pubkey as PubkeyHex, relaysToUse),
      fetchProfile(event.pubkey, relaysToUse),
    ]);
    if (!isRouteActive()) {
      return;
    }

    if (deleted) {
      if (!isRouteActive()) return; // Guard before DOM update
      options.output.innerHTML = "<p class='text-gray-600'>This event was deleted by the author.</p>";
      return;
    }

    // Update profile if we got one from relays (whether cached or not)
    if (eventProfile) {
      if (!isRouteActive()) return; // Guard before DOM update
      const eventCard: HTMLElement | null = options.output.querySelector(".event-container");
      const nameEl: HTMLElement | null = eventCard?.querySelector(".event-username") as HTMLElement | null;
      const avatarEl: HTMLImageElement | null = eventCard?.querySelector(".event-avatar") as HTMLImageElement | null;
      if (nameEl) {
        nameEl.textContent = `👤 ${getDisplayName(npubStr, eventProfile)}`;
      }
      if (avatarEl) {
        const avatarUrl = getAvatarURL(event.pubkey, eventProfile);
        avatarEl.src = avatarUrl;
      }
    }

    if (!isRouteActive()) {
      return;
    }

    // Wait for reactions and replies in parallel
    await Promise.all([
      reactionsPromise,
      renderReplyTree(event, relaysToUse, options.output, isRouteActive)
    ]);
  } catch (error: unknown) {
    console.error("Failed to load nevent:", error);
    if (options.output) {
      options.output.innerHTML = "<p class='text-red-500'>Failed to load event.</p>";
    }
  }
}

function resolveReplyParentId(event: NostrEvent): string | null {
  const eTags: string[][] = event.tags.filter((tag: string[]): boolean => tag[0] === "e");
  if (eTags.length === 0) {
    return null;
  }

  const replyTag: string[] | undefined = eTags.find((tag: string[]): boolean => tag[3] === "reply");
  if (replyTag?.[1]) {
    return replyTag[1];
  }

  return eTags[eTags.length - 1]?.[1] || null;
}

async function renderReplyTree(
  rootEvent: NostrEvent,
  relays: string[],
  output: HTMLElement,
  isRouteActive: () => boolean,
): Promise<void> {
  // Check if route is still active before fetching
  if (!isRouteActive()) return;

  const replies: NostrEvent[] = await fetchRepliesForEvent(rootEvent.id, relays);
  if (!isRouteActive()) return; // Guard before DOM update
  const section: HTMLDivElement = document.createElement("div");
  section.className = "mt-6";
  section.innerHTML = `<h3 class="text-lg font-semibold mb-3">Replies</h3>`;
  output.appendChild(section);

  if (replies.length === 0) {
    const empty: HTMLDivElement = document.createElement("div");
    empty.className = "text-sm text-gray-500";
    empty.textContent = "No replies yet.";
    section.appendChild(empty);
    return;
  }

  const byId: Map<string, NostrEvent> = new Map();
  replies.forEach((event: NostrEvent): void => {
    byId.set(event.id, event);
  });

  const children: Map<string, NostrEvent[]> = new Map();
  const roots: NostrEvent[] = [];

  replies.forEach((event: NostrEvent): void => {
    const parentId: string | null = resolveReplyParentId(event);
    const attachTo: string = parentId && (parentId === rootEvent.id || byId.has(parentId))
      ? parentId
      : rootEvent.id;

    if (attachTo === rootEvent.id) {
      roots.push(event);
    } else {
      const list: NostrEvent[] = children.get(attachTo) || [];
      list.push(event);
      children.set(attachTo, list);
    }
  });

  const allPubkeys: PubkeyHex[] = Array.from(new Set(replies.map((event: NostrEvent): PubkeyHex => event.pubkey)));
  const profiles: Map<PubkeyHex, NostrProfile | null> = new Map();

  // First, try to get profiles from IndexedDB cache
  await Promise.allSettled(
    allPubkeys.map(async (pubkey: PubkeyHex): Promise<void> => {
      const cached = await getCachedProfile(pubkey);
      if (cached) {
        profiles.set(pubkey, cached);
      }
    }),
  );

  // Then fetch missing profiles from relays
  const missingPubkeys = allPubkeys.filter((pk) => !profiles.has(pk));
  if (missingPubkeys.length > 0) {
    await Promise.allSettled(
      missingPubkeys.map(async (pubkey: PubkeyHex): Promise<void> => {
        const profile: NostrProfile | null = await fetchProfile(pubkey, relays);
        profiles.set(pubkey, profile);
      }),
    );
  }

  const renderNode = (event: NostrEvent, depth: number): void => {
    if (!isRouteActive()) return; // Guard before DOM operations
    const wrapper: HTMLDivElement = document.createElement("div");
    wrapper.className = "mt-4";
    if (depth > 0) {
      wrapper.classList.add("border-l", "border-gray-200", "pl-4");
      wrapper.style.marginLeft = `${depth * 16}px`;
    }

    const temp: HTMLDivElement = document.createElement("div");
    const npub: Npub = nip19.npubEncode(event.pubkey);
    const profile: NostrProfile | null = profiles.get(event.pubkey) || null;
    renderEvent(event, profile, npub, event.pubkey as PubkeyHex, temp);
    const card: Element | null = temp.firstElementChild;
    if (card instanceof HTMLElement) {
      const parentContainer: HTMLElement | null = card.querySelector(".parent-event-container");
      if (parentContainer) {
        parentContainer.style.display = "none";
      }
      wrapper.appendChild(card);
    }
    section.appendChild(wrapper);

    const childEvents: NostrEvent[] = children.get(event.id) || [];
    childEvents.sort((a: NostrEvent, b: NostrEvent): number => a.created_at - b.created_at);
    childEvents.forEach((child: NostrEvent): void => {
      renderNode(child, depth + 1);
    });
  };

  roots.sort((a: NostrEvent, b: NostrEvent): number => a.created_at - b.created_at);
  roots.forEach((event: NostrEvent): void => renderNode(event, 0));
}
