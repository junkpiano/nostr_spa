import { nip19 } from 'nostr-tools';
import { fetchProfile } from "../profile/profile.js";
import { fetchEventById, fetchRepliesForEvent, isEventDeleted } from "../../common/events-queries.js";
import { loadReactionsForEvent, renderEvent } from "../../common/event-render.js";
import { setEventMeta } from "../../common/meta.js";
import { setActiveNav } from "../../common/navigation.js";
import { getAvatarURL, getDisplayName } from "../../utils/utils.js";
import type { NostrEvent, NostrProfile, PubkeyHex, Npub } from "../../../types/nostr";

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

    const reactionsContainer: HTMLElement | null = options.output.querySelector(".reactions-container");
    if (reactionsContainer) {
      await loadReactionsForEvent(event.id, event.pubkey as PubkeyHex, reactionsContainer);
    }

    await renderReplyTree(event, relaysToUse, options.output);
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
): Promise<void> {
  const replies: NostrEvent[] = await fetchRepliesForEvent(rootEvent.id, relays);
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
  await Promise.allSettled(
    allPubkeys.map(async (pubkey: PubkeyHex): Promise<void> => {
      const profile: NostrProfile | null = await fetchProfile(pubkey, relays);
      profiles.set(pubkey, profile);
    }),
  );

  const renderNode = (event: NostrEvent, depth: number): void => {
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
