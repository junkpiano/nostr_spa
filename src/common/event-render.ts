import { nip19, finalizeEvent } from 'nostr-tools';
import { getAvatarURL, getDisplayName, fetchOGP, isTwitterURL, fetchTwitterEmbed, loadTwitterWidgets, replaceEmojiShortcodes } from "../utils/utils.js";
import { fetchProfile } from "../features/profile/profile.js";
import { getRelays } from "../features/relays/relays.js";
import { getSessionPrivateKey } from "./session.js";
import { fetchEventById, isEventDeleted } from "./events-queries.js";
import type { NostrProfile, PubkeyHex, Npub, NostrEvent, OGPResponse } from "../../types/nostr";

const referencedEventCache: Map<string, Promise<NostrEvent | null>> = new Map();
const reactionCache: Map<string, Promise<Map<string, number>>> = new Map();
const reactionEventsCache: Map<string, Promise<NostrEvent[]>> = new Map();

function fetchEventByIdCached(eventId: string, relays: string[]): Promise<NostrEvent | null> {
  const cached: Promise<NostrEvent | null> | undefined = referencedEventCache.get(eventId);
  if (cached) {
    return cached;
  }
  const request: Promise<NostrEvent | null> = fetchEventById(eventId, relays).then((event: NostrEvent | null) => {
    if (!event) {
      referencedEventCache.delete(eventId);
    }
    return event;
  });
  referencedEventCache.set(eventId, request);
  return request;
}

async function fetchReactions(eventId: string, relays: string[]): Promise<Map<string, number>> {
  const cached: Promise<Map<string, number>> | undefined = reactionCache.get(eventId);
  if (cached) {
    return cached;
  }

  const request: Promise<Map<string, number>> = new Promise<Map<string, number>>((resolve) => {
    const counts: Map<string, number> = new Map();
    const seenReactionIds: Set<string> = new Set();

    const promises = relays.map(async (relayUrl: string): Promise<void> => {
      try {
        const socket: WebSocket = new WebSocket(relayUrl);
        await new Promise<void>((innerResolve) => {
          let settled: boolean = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.close();
            innerResolve();
          };

          const timeout = setTimeout(() => {
            finish();
          }, 5000);

          socket.onopen = (): void => {
            const subId: string = "reactions-" + Math.random().toString(36).slice(2);
            const req: [string, string, { kinds: number[]; "#e": string[]; limit: number }] = [
              "REQ",
              subId,
              { kinds: [7], "#e": [eventId], limit: 50 },
            ];
            socket.send(JSON.stringify(req));
          };

          socket.onmessage = (msg: MessageEvent): void => {
            const arr: any[] = JSON.parse(msg.data);
            if (arr[0] === "EVENT" && arr[2]) {
              const event: NostrEvent = arr[2];
              if (event.kind !== 7 || seenReactionIds.has(event.id)) {
                return;
              }
              seenReactionIds.add(event.id);
              const reaction: string = normalizeReaction(event.content);
              const current: number = counts.get(reaction) || 0;
              counts.set(reaction, current + 1);
            } else if (arr[0] === "EOSE") {
              finish();
            }
          };

          socket.onerror = (): void => {
            finish();
          };
        });
      } catch (e) {
        console.warn(`Failed to fetch reactions from ${relayUrl}:`, e);
      }
    });

    Promise.allSettled(promises).then(() => {
      resolve(counts);
    });
  });

  reactionCache.set(eventId, request);
  return request;
}

async function fetchReactionEvents(eventId: string, relays: string[]): Promise<NostrEvent[]> {
  const cached: Promise<NostrEvent[]> | undefined = reactionEventsCache.get(eventId);
  if (cached) {
    return cached;
  }

  const request: Promise<NostrEvent[]> = new Promise<NostrEvent[]>((resolve) => {
    const events: Map<string, NostrEvent> = new Map();

    const promises = relays.map(async (relayUrl: string): Promise<void> => {
      try {
        const socket: WebSocket = new WebSocket(relayUrl);
        await new Promise<void>((innerResolve) => {
          let settled: boolean = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.close();
            innerResolve();
          };

          const timeout = setTimeout(() => {
            finish();
          }, 5000);

          socket.onopen = (): void => {
            const subId: string = "reactions-events-" + Math.random().toString(36).slice(2);
            const req: [string, string, { kinds: number[]; "#e": string[]; limit: number }] = [
              "REQ",
              subId,
              { kinds: [7], "#e": [eventId], limit: 100 },
            ];
            socket.send(JSON.stringify(req));
          };

          socket.onmessage = (msg: MessageEvent): void => {
            const arr: any[] = JSON.parse(msg.data);
            if (arr[0] === "EVENT" && arr[2]) {
              const event: NostrEvent = arr[2];
              if (event.kind !== 7) {
                return;
              }
              events.set(event.id, event);
            } else if (arr[0] === "EOSE") {
              finish();
            }
          };

          socket.onerror = (): void => {
            finish();
          };
        });
      } catch (e) {
        console.warn(`Failed to fetch reaction events from ${relayUrl}:`, e);
      }
    });

    Promise.allSettled(promises).then(() => {
      const list: NostrEvent[] = Array.from(events.values());
      list.sort((a: NostrEvent, b: NostrEvent): number => b.created_at - a.created_at);
      resolve(list);
    });
  });

  reactionEventsCache.set(eventId, request);
  return request;
}

function normalizeReaction(content: string | undefined): string {
  const trimmed: string = replaceEmojiShortcodes(content || "").trim();
  return trimmed ? trimmed : "❤";
}

function resolveParentAuthorPubkey(event: NostrEvent): PubkeyHex | null {
  const pTags: string[][] = event.tags.filter((tag: string[]): boolean => tag[0] === "p");
  const replyTag: string[] | undefined = pTags.find((tag: string[]): boolean => tag[3] === "reply");
  if (replyTag?.[1]) {
    return replyTag[1] as PubkeyHex;
  }
  const rootTag: string[] | undefined = pTags.find((tag: string[]): boolean => tag[3] === "root");
  if (rootTag?.[1]) {
    return rootTag[1] as PubkeyHex;
  }
  return (pTags[0]?.[1] as PubkeyHex) || null;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchEventWithRetry(eventId: string, relays: string[], attempts: number = 3): Promise<NostrEvent | null> {
  for (let i = 0; i < attempts; i += 1) {
    const event: NostrEvent | null = await fetchEventByIdCached(eventId, relays);
    if (event) {
      return event;
    }
    if (i < attempts - 1) {
      await delay(800);
    }
  }
  return null;
}

export async function loadReactionsForEvent(
  eventId: string,
  targetPubkey: PubkeyHex,
  container: HTMLElement,
): Promise<void> {
  const relays: string[] = getRelays();
  try {
    const counts: Map<string, number> = await fetchReactions(eventId, relays);
    if (counts.size === 0) {
      container.innerHTML = "";
      return;
    }

    const entries: Array<[string, number]> = Array.from(counts.entries());
    entries.sort((a: [string, number], b: [string, number]): number => b[1] - a[1]);
    const top: Array<[string, number]> = entries.slice(0, 5);

    container.innerHTML = "";
    top.forEach(([reaction, count]: [string, number]): void => {
      const badge: HTMLSpanElement = document.createElement("span");
      badge.className = "relative inline-flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2 py-1 cursor-pointer hover:bg-gray-50 transition-colors";
      badge.dataset.reaction = reaction;
      const emojiEl: HTMLSpanElement = document.createElement("span");
      emojiEl.textContent = reaction;
      const countEl: HTMLSpanElement = document.createElement("span");
      countEl.className = "font-semibold text-gray-700";
      countEl.textContent = count.toString();
      badge.appendChild(emojiEl);
      badge.appendChild(countEl);

      const tooltip: HTMLDivElement = document.createElement("div");
      tooltip.className = "fixed w-56 rounded-lg border border-gray-200 bg-white shadow-lg p-2 text-xs text-gray-700 z-50";
      tooltip.style.display = "none";
      document.body.appendChild(tooltip);

      let hoverTimeout: number | null = null;

      const positionTooltip = (): void => {
        const rect: DOMRect = badge.getBoundingClientRect();
        const spacing: number = 8;
        const top: number = rect.bottom + spacing;
        const left: number = Math.min(rect.left, window.innerWidth - 240);
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${Math.max(left, 8)}px`;
      };

      const showTooltip = (): void => {
        if (hoverTimeout) {
          window.clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        positionTooltip();
        tooltip.style.display = "block";
        loadReactionDetails(eventId, reaction, tooltip);
      };

      const hideTooltip = (): void => {
        if (hoverTimeout) {
          window.clearTimeout(hoverTimeout);
        }
        hoverTimeout = window.setTimeout((): void => {
          tooltip.style.display = "none";
        }, 150);
      };

      badge.addEventListener("mouseenter", showTooltip);
      badge.addEventListener("mouseleave", hideTooltip);
      tooltip.addEventListener("mouseenter", showTooltip);
      tooltip.addEventListener("mouseleave", hideTooltip);

      window.addEventListener("scroll", () => {
        if (tooltip.style.display !== "none") {
          positionTooltip();
        }
      });

      badge.addEventListener("click", (event: MouseEvent): void => {
        event.preventDefault();
        publishReaction(eventId, targetPubkey, reaction);
      });
      container.appendChild(badge);
    });
  } catch (error: unknown) {
    console.warn("Failed to load reactions:", error);
  }
}

async function loadReactionDetails(eventId: string, reaction: string, container: HTMLElement): Promise<void> {
  container.dataset.reaction = reaction;
  container.innerHTML = "<div class=\"text-xs text-gray-500\">Loading reactions...</div>";

  const relays: string[] = getRelays();
  try {
    const events: NostrEvent[] = await fetchReactionEvents(eventId, relays);
    const filtered: NostrEvent[] = events.filter(
      (event: NostrEvent): boolean => normalizeReaction(event.content) === reaction,
    );

    if (filtered.length === 0) {
      container.innerHTML = "<div class=\"text-xs text-gray-500\">No reactions yet.</div>";
      return;
    }

    container.innerHTML = "";
    const list: HTMLDivElement = document.createElement("div");
    list.className = "space-y-2 max-h-48 overflow-auto";
    container.appendChild(list);

    await Promise.allSettled(
      filtered.slice(0, 20).map(async (event: NostrEvent): Promise<void> => {
        let profile: NostrProfile | null = null;
        try {
          profile = await fetchProfile(event.pubkey, relays);
        } catch (error: unknown) {
          console.warn("Failed to load profile for reaction:", error);
        }

        const npub: Npub = nip19.npubEncode(event.pubkey);
        const name: string = getDisplayName(npub, profile);
        const avatar: string = getAvatarURL(event.pubkey, profile);

        const row: HTMLAnchorElement = document.createElement("a");
        row.className = "flex items-center gap-2 text-sm text-gray-700 hover:text-blue-600 transition-colors";
        row.href = `/${npub}`;

        const img: HTMLImageElement = document.createElement("img");
        img.src = avatar;
        img.alt = name;
        img.className = "w-6 h-6 rounded-full object-cover";
        img.onerror = (): void => {
          img.src = "https://placekitten.com/80/80";
        };

        const nameEl: HTMLSpanElement = document.createElement("span");
        nameEl.textContent = name;

        row.appendChild(img);
        row.appendChild(nameEl);
        list.appendChild(row);
      }),
    );
  } catch (error: unknown) {
    console.warn("Failed to load reaction details:", error);
    container.innerHTML = "<div class=\"text-xs text-gray-500\">Failed to load reactions.</div>";
  }
}

async function publishReaction(
  eventId: string,
  targetPubkey: PubkeyHex,
  reaction: string,
): Promise<void> {
  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
  if (!storedPubkey) {
    alert("Sign in to react.");
    return;
  }

  const unsignedEvent: Omit<NostrEvent, "id" | "sig"> = {
    kind: 7,
    pubkey: storedPubkey as PubkeyHex,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", eventId],
      ["p", targetPubkey],
    ],
    content: reaction,
  };

  let signedEvent: NostrEvent;
  if ((window as any).nostr && (window as any).nostr.signEvent) {
    signedEvent = await (window as any).nostr.signEvent(unsignedEvent);
  } else {
    const privateKey: Uint8Array | null = getSessionPrivateKey();
    if (!privateKey) {
      alert("Sign in to react.");
      return;
    }
    signedEvent = finalizeEvent(unsignedEvent, privateKey) as NostrEvent;
  }

  const relays: string[] = getRelays();
  const promises = relays.map(async (relayUrl: string): Promise<void> => {
    try {
      const socket: WebSocket = new WebSocket(relayUrl);
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          socket.close();
          resolve();
        }, 5000);

        socket.onopen = (): void => {
          socket.send(JSON.stringify(["EVENT", signedEvent]));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === "OK") {
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
      console.warn(`Failed to publish reaction to ${relayUrl}:`, e);
    }
  });

  await Promise.allSettled(promises);
}

export function renderEvent(
  event: NostrEvent,
  profile: NostrProfile | null,
  npub: Npub,
  pubkey: PubkeyHex,
  output: HTMLElement,
): void {
  const avatar: string = getAvatarURL(pubkey, profile);
  const name: string = getDisplayName(npub, profile);
  const createdAt: string = new Date(event.created_at * 1000).toLocaleString();
  let eventPermalink: string | null = null;
  try {
    eventPermalink = `/${nip19.neventEncode({ id: event.id })}`;
  } catch (e) {
    console.warn("Failed to encode nevent for event link:", e);
    eventPermalink = null;
  }
  const dateHtml: string = eventPermalink
    ? `<a href="${eventPermalink}" class="text-xs text-gray-500 hover:text-blue-600 transition-colors">🕒 ${createdAt}</a>`
    : `<div class="text-xs text-gray-500">🕒 ${createdAt}</div>`;
  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
  const canDeletePost: boolean = Boolean(storedPubkey && storedPubkey === event.pubkey);
  const deleteButtonHtml: string = canDeletePost
    ? `
          <button class="delete-event-btn text-red-500 hover:text-red-700 transition-colors p-1 rounded" aria-label="Delete post" title="Delete post">
            🗑️
          </button>
        `
    : "";

  const urls: string[] = [];
  const imageUrls: string[] = [];
  const mentionedNpubs: string[] = Array.from(
    new Set(
      [...event.content.matchAll(/nostr:(npub1[0-9a-z]+)/gi)]
        .map((match: RegExpMatchArray): string | undefined => match[1])
        .filter((value: string | undefined): value is string => Boolean(value)),
    ),
  );
  const mentionNpubToPubkey: Map<string, PubkeyHex> = new Map();
  mentionedNpubs.forEach((mentionedNpub: string): void => {
    try {
      const decoded = nip19.decode(mentionedNpub);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        mentionNpubToPubkey.set(mentionedNpub, decoded.data as PubkeyHex);
      }
    } catch (error: unknown) {
      console.warn("Failed to decode mentioned npub:", error);
    }
  });
  const referencedEventRefs: string[] = Array.from(
    new Set(
      [...event.content.matchAll(/nostr:((?:nevent1|note1)[0-9a-z]+)/gi)]
        .map((match: RegExpMatchArray): string | undefined => match[1])
        .filter((value: string | undefined): value is string => Boolean(value)),
    ),
  );
  const parentEventId: string | null = resolveParentEventId(event);
  const parentAuthorPubkey: PubkeyHex | null = parentEventId ? resolveParentAuthorPubkey(event) : null;
  const contentWithEmoji: string = replaceEmojiShortcodes(event.content);
  const contentWithNostrLinks: string = contentWithEmoji.replace(
    /(nostr:(?:nevent1|note1)[0-9a-z]+)/gi,
    (eventRef: string): string => {
      const path: string = `/${eventRef.replace(/^nostr:/i, "")}`;
      return `<a href="${path}" class="text-indigo-600 underline">${eventRef}</a>`;
    },
  );

  const contentWithMentions: string = contentWithNostrLinks.replace(
    /(nostr:npub1[0-9a-z]+)/gi,
    (npubRef: string): string => {
      const mentionedNpub: string = npubRef.replace(/^nostr:/i, "");
      const label: string = `@${mentionedNpub.slice(0, 12)}...`;
      return `<a href="/${mentionedNpub}" class="text-indigo-600 underline mention-link" data-mention-npub="${mentionedNpub}">${label}</a>`;
    },
  );

  const contentWithLinks: string = contentWithMentions.replace(
    /(https?:\/\/[^\s]+)/g,
    (url: string): string => {
      if (url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) {
        const imageIndex: number = imageUrls.length;
        imageUrls.push(url);
        return `<img src="${url}" alt="Image" class="my-2 max-w-full rounded shadow cursor-zoom-in event-image" loading="lazy" data-image-index="${imageIndex}" />`;
      }

      urls.push(url);
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 underline">${url}</a>`;
    },
  );

  const div: HTMLDivElement = document.createElement("div");
  div.className = "bg-gray-50 border border-gray-200 rounded p-4 shadow event-container";
  div.dataset.pubkey = pubkey;
  if (imageUrls.length > 0) {
    div.dataset.images = JSON.stringify(imageUrls);
  }
  div.innerHTML = `
		    <div class="flex items-start space-x-4">
	      <a href="/${npub}" class="flex-shrink-0 hover:opacity-80 transition-opacity">
	        <img src="${avatar}" alt="Avatar" class="event-avatar w-12 h-12 rounded-full object-cover cursor-pointer"
	          onerror="this.src='https://placekitten.com/100/100';" />
	      </a>
		      <div class="flex-1 overflow-hidden">
		        <a href="/${npub}" class="event-username font-semibold text-gray-800 text-sm mb-1 hover:text-blue-600 transition-colors inline-block">👤 ${name}</a>
            <div class="parent-event-container mb-2"></div>
			        <div class="whitespace-pre-wrap break-words break-all mb-2 text-sm text-gray-700">${contentWithLinks}</div>
            <div class="referenced-events-container space-y-2"></div>
		        <div class="ogp-container"></div>
            <div class="reactions-container mt-2 flex flex-wrap gap-2 text-xs text-gray-600"></div>
            <div class="reactions-details mt-2" style="display: none;"></div>
            <div class="mt-2 flex items-center justify-between gap-2">
                ${dateHtml}
                ${deleteButtonHtml}
            </div>
		      </div>
		    </div>
		  `;
  output.appendChild(div);
  if (parentEventId) {
    const parentContainer: HTMLElement | null = div.querySelector(".parent-event-container");
    if (parentContainer) {
      renderParentEventCard(parentEventId, parentAuthorPubkey, parentContainer);
    }
  }
  if (mentionNpubToPubkey.size > 0) {
    enrichMentionDisplayNames(div, mentionNpubToPubkey);
  }

  const deleteButton: HTMLButtonElement | null = div.querySelector(".delete-event-btn") as HTMLButtonElement | null;
  if (deleteButton) {
    deleteButton.addEventListener("click", async (): Promise<void> => {
      const confirmed: boolean = window.confirm("Delete this post?");
      if (!confirmed) {
        return;
      }

      deleteButton.disabled = true;
      deleteButton.classList.add("opacity-60", "cursor-not-allowed");

      try {
        await deleteEventOnRelays(event);
        div.remove();
      } catch (error: unknown) {
        console.error("Failed to delete event:", error);
        alert("Failed to delete post. Please try again.");
        deleteButton.disabled = false;
        deleteButton.classList.remove("opacity-60", "cursor-not-allowed");
      }
    });
  }

  if (urls.length > 0) {
    const ogpContainer: HTMLElement | null = div.querySelector(".ogp-container");
    if (ogpContainer) {
      urls.forEach(async (url: string): Promise<void> => {
        if (isTwitterURL(url)) {
          const embedHTML: string | null = await fetchTwitterEmbed(url);
          if (embedHTML) {
            renderTwitterEmbed(embedHTML, ogpContainer);
            loadTwitterWidgets();
          }
        } else {
          const ogpData: OGPResponse | null = await fetchOGP(url);
          if (ogpData && ogpData.data) {
            renderOGPCard(ogpData, ogpContainer);
          }
        }
      });
    }
  }

  if (referencedEventRefs.length > 0) {
    const referencedContainer: HTMLElement | null = div.querySelector(".referenced-events-container");
    if (referencedContainer) {
      renderReferencedEventCards(referencedEventRefs, referencedContainer);
    }
  }
}

function resolveParentEventId(event: NostrEvent): string | null {
  const eTags: string[][] = event.tags.filter((tag: string[]): boolean => tag[0] === "e" && Boolean(tag[1]));
  if (eTags.length === 0) {
    return null;
  }

  const replyTag: string[] | undefined = eTags.find((tag: string[]): boolean => tag[3] === "reply");
  if (replyTag?.[1]) {
    return replyTag[1];
  }

  const rootTag: string[] | undefined = eTags.find((tag: string[]): boolean => tag[3] === "root");
  if (rootTag?.[1]) {
    return rootTag[1];
  }

  return eTags[eTags.length - 1]?.[1] || null;
}

async function renderParentEventCard(
  parentEventId: string,
  parentAuthorPubkey: PubkeyHex | null,
  container: HTMLElement,
): Promise<void> {
  container.innerHTML = "";
  const card: HTMLDivElement = document.createElement("div");
  card.className = "border border-amber-200 bg-amber-50 rounded-lg p-3";
  card.textContent = "Loading parent post...";
  container.appendChild(card);

  try {
    const relays: string[] = getRelays();
    if (parentAuthorPubkey) {
      const deleted: boolean = await isEventDeleted(parentEventId, parentAuthorPubkey, relays);
      if (deleted) {
        card.textContent = "Parent post was deleted.";
        return;
      }
    }

    const parentEvent: NostrEvent | null = await fetchEventWithRetry(parentEventId, relays, 3);
    if (!parentEvent) {
      card.textContent = "Failed to load parent post.";
      return;
    }

    const parentProfile: NostrProfile | null = await fetchProfile(parentEvent.pubkey, relays);
    const parentNpub: Npub = nip19.npubEncode(parentEvent.pubkey);
    const parentName: string = getDisplayName(parentNpub, parentProfile);
    const parentAvatar: string = getAvatarURL(parentEvent.pubkey, parentProfile);
    const parentContent: string = replaceEmojiShortcodes(parentEvent.content);
    const preview: string = parentContent.length > 220
      ? `${parentContent.slice(0, 220)}...`
      : parentContent;
    const parentPath: string = `/${nip19.neventEncode({ id: parentEvent.id })}`;

    card.innerHTML = `
      <a href="${parentPath}" class="block hover:bg-amber-100 rounded transition-colors p-1">
        <div class="text-xs text-amber-700 font-semibold mb-1">Replying to</div>
        <div class="flex items-start gap-2">
          <img
            src="${parentAvatar}"
            alt="${parentName}"
            class="w-8 h-8 rounded-full object-cover flex-shrink-0"
            onerror="this.src='https://placekitten.com/80/80';"
          />
          <div class="min-w-0">
            <div class="text-xs text-gray-700 font-semibold mb-1 truncate">${parentName}</div>
            <div class="text-sm text-gray-800 whitespace-pre-wrap break-words">${preview || "(no content)"}</div>
          </div>
        </div>
      </a>
    `;
  } catch (error: unknown) {
    console.warn("Failed to render parent event card:", error);
    card.textContent = "Failed to load parent post.";
  }
}

async function enrichMentionDisplayNames(
  eventContainer: HTMLElement,
  mentionNpubToPubkey: Map<string, PubkeyHex>,
): Promise<void> {
  const relays: string[] = getRelays();

  for (const [mentionedNpub, mentionedPubkey] of mentionNpubToPubkey.entries()) {
    try {
      const mentionedProfile: NostrProfile | null = await fetchProfile(mentionedPubkey, relays);
      const displayName: string = getDisplayName(mentionedNpub as Npub, mentionedProfile);
      const anchors: NodeListOf<HTMLAnchorElement> = eventContainer.querySelectorAll(
        `a.mention-link[data-mention-npub="${mentionedNpub}"]`,
      );
      anchors.forEach((anchor: HTMLAnchorElement): void => {
        anchor.textContent = `@${displayName}`;
      });
    } catch (error: unknown) {
      console.warn("Failed to resolve mentioned profile:", error);
    }
  }
}

async function deleteEventOnRelays(targetEvent: NostrEvent): Promise<void> {
  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
  if (!storedPubkey || storedPubkey !== targetEvent.pubkey) {
    throw new Error("You can only delete your own posts.");
  }

  const unsignedEvent: Omit<NostrEvent, "id" | "sig"> = {
    kind: 5,
    pubkey: storedPubkey as PubkeyHex,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["e", targetEvent.id]],
    content: "",
  };

  let signedEvent: NostrEvent;
  if ((window as any).nostr && (window as any).nostr.signEvent) {
    signedEvent = await (window as any).nostr.signEvent(unsignedEvent);
  } else {
    const privateKey: Uint8Array | null = getSessionPrivateKey();
    if (!privateKey) {
      throw new Error("No signing method available");
    }
    signedEvent = finalizeEvent(unsignedEvent, privateKey) as NostrEvent;
  }

  const relays: string[] = getRelays();
  const publishPromises = relays.map(async (relayUrl: string): Promise<void> => {
    try {
      const socket: WebSocket = new WebSocket(relayUrl);
      await new Promise<void>((resolve) => {
        let settled: boolean = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.close();
          resolve();
        };

        const timeout = setTimeout(() => {
          finish();
        }, 5000);

        socket.onopen = (): void => {
          socket.send(JSON.stringify(["EVENT", signedEvent]));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === "OK") {
            finish();
          }
        };

        socket.onerror = (): void => {
          finish();
        };
      });
    } catch (e) {
      console.warn(`Failed to publish delete event to ${relayUrl}:`, e);
    }
  });

  await Promise.allSettled(publishPromises);
}

async function renderReferencedEventCards(eventRefs: string[], container: HTMLElement): Promise<void> {
  const currentRelays: string[] = getRelays();
  const maxCards: number = 3;

  for (const eventRef of eventRefs.slice(0, maxCards)) {
    const card: HTMLDivElement = document.createElement("div");
    card.className = "border border-indigo-200 bg-indigo-50 rounded-lg p-3";
    card.textContent = "Loading referenced event...";
    container.appendChild(card);

    try {
      const decoded = nip19.decode(eventRef);
      let eventId: string | undefined;
      let relayHints: string[] = [];
      let referencedAuthorPubkey: PubkeyHex | null = null;
      if (decoded.type === "nevent") {
        const data: any = decoded.data;
        eventId = data?.id || (typeof data === "string" ? data : undefined);
        relayHints = Array.isArray(data?.relays) ? data.relays : [];
        if (data?.author && typeof data.author === "string") {
          referencedAuthorPubkey = data.author as PubkeyHex;
        }
      } else if (decoded.type === "note") {
        eventId = typeof decoded.data === "string" ? decoded.data : undefined;
      } else {
        card.textContent = "Referenced event is invalid.";
        continue;
      }

      if (!eventId) {
        card.textContent = "Referenced event ID is missing.";
        continue;
      }

      const relaysToUse: string[] = relayHints.length > 0 ? relayHints : currentRelays;
      if (referencedAuthorPubkey) {
        const deleted: boolean = await isEventDeleted(eventId, referencedAuthorPubkey, relaysToUse);
        if (deleted) {
          card.textContent = "Referenced event was deleted.";
          continue;
        }
      }

      const referencedEvent: NostrEvent | null = await fetchEventWithRetry(eventId, relaysToUse, 3);
      if (!referencedEvent) {
        card.textContent = "Failed to load referenced event.";
        continue;
      }

      const referencedProfile: NostrProfile | null = await fetchProfile(referencedEvent.pubkey, relaysToUse);
      const referencedNpub: Npub = nip19.npubEncode(referencedEvent.pubkey);
      const referencedName: string = getDisplayName(referencedNpub, referencedProfile);
      const referencedAvatar: string = getAvatarURL(referencedEvent.pubkey, referencedProfile);
      const referencedContent: string = replaceEmojiShortcodes(referencedEvent.content);
      const referencedText: string = referencedContent.length > 180
        ? `${referencedContent.slice(0, 180)}...`
        : referencedContent;
      const referencedPath: string = `/${eventRef}`;

      card.innerHTML = `
                <a href="${referencedPath}" class="block hover:bg-indigo-100 rounded transition-colors p-1">
                    <div class="flex items-start gap-2">
                        <img
                            src="${referencedAvatar}"
                            alt="${referencedName}"
                            class="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            onerror="this.src='https://placekitten.com/80/80';"
                        />
                        <div class="min-w-0">
                            <div class="text-xs text-gray-700 font-semibold mb-1 truncate">${referencedName}</div>
                            <div class="text-sm text-gray-800 whitespace-pre-wrap break-words">${referencedText || "(no content)"}</div>
                        </div>
                    </div>
                </a>
            `;
    } catch (error: unknown) {
      console.warn("Failed to render referenced event card:", error);
      card.textContent = "Failed to load referenced event.";
    }
  }
}

function renderOGPCard(ogpData: OGPResponse, container: HTMLElement): void {
  const title: string = ogpData.data["og:title"] || ogpData.data.title || "No title";
  const description: string = ogpData.data["og:description"] || ogpData.data.description || "";
  const image: string | undefined = ogpData.data["og:image"];
  const siteName: string = ogpData.data["og:site_name"] || "";
  const url: string = ogpData.url;

  const card: HTMLDivElement = document.createElement("div");
  card.className = "border border-gray-300 rounded-lg overflow-hidden my-2 hover:shadow-md transition-shadow bg-white";

  card.innerHTML = `
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="block no-underline">
            ${image ? `<img src="${image}" alt="${title}" class="w-full h-48 object-cover" loading="lazy" onerror="this.style.display='none';" />` : ""}
            <div class="p-3">
                ${siteName ? `<div class="text-xs text-gray-500 mb-1">${siteName}</div>` : ""}
                <div class="font-semibold text-gray-900 text-sm mb-1 line-clamp-2">${title}</div>
                ${description ? `<div class="text-xs text-gray-600 line-clamp-2">${description}</div>` : ""}
            </div>
        </a>
    `;

  container.appendChild(card);
}

function renderTwitterEmbed(embedHTML: string, container: HTMLElement): void {
  const wrapper: HTMLDivElement = document.createElement("div");
  wrapper.className = "my-2";
  wrapper.innerHTML = embedHTML;
  container.appendChild(wrapper);
}
