import { nip19, finalizeEvent } from "https://esm.sh/nostr-tools@2.17.0";
import { getAvatarURL, getDisplayName, fetchOGP, isTwitterURL, fetchTwitterEmbed, loadTwitterWidgets } from "./utils.js";
import { fetchProfile } from "./profile.js";
import { getRelays } from "./relays.js";
import { getSessionPrivateKey } from "./session.js";
import { fetchEventById } from "./events-queries.js";
import type { NostrProfile, PubkeyHex, Npub, NostrEvent, OGPResponse } from "../types/nostr";

const referencedEventCache: Map<string, Promise<NostrEvent | null>> = new Map();

function fetchEventByIdCached(eventId: string, relays: string[]): Promise<NostrEvent | null> {
  const cached: Promise<NostrEvent | null> | undefined = referencedEventCache.get(eventId);
  if (cached) {
    return cached;
  }
  const request: Promise<NostrEvent | null> = fetchEventById(eventId, relays);
  referencedEventCache.set(eventId, request);
  return request;
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
  const referencedNevents: string[] = Array.from(
    new Set(
      [...event.content.matchAll(/nostr:(nevent1[0-9a-z]+)/gi)]
        .map((match: RegExpMatchArray): string | undefined => match[1])
        .filter((value: string | undefined): value is string => Boolean(value)),
    ),
  );
  const contentWithNostrLinks: string = event.content.replace(
    /(nostr:nevent1[0-9a-z]+)/gi,
    (nevent: string): string => {
      const path: string = `/${nevent.replace(/^nostr:/i, "")}`;
      return `<a href="${path}" class="text-indigo-600 underline">${nevent}</a>`;
    },
  );

  const contentWithLinks: string = contentWithNostrLinks.replace(
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
		        <div class="whitespace-pre-wrap break-words break-all mb-2 text-sm text-gray-700">${contentWithLinks}</div>
            <div class="referenced-events-container space-y-2"></div>
		        <div class="ogp-container"></div>
            <div class="mt-2 flex items-center justify-between gap-2">
                ${dateHtml}
                ${deleteButtonHtml}
            </div>
		      </div>
		    </div>
		  `;
  output.appendChild(div);

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

  if (referencedNevents.length > 0) {
    const referencedContainer: HTMLElement | null = div.querySelector(".referenced-events-container");
    if (referencedContainer) {
      renderReferencedEventCards(referencedNevents, referencedContainer);
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

async function renderReferencedEventCards(nevents: string[], container: HTMLElement): Promise<void> {
  const currentRelays: string[] = getRelays();
  const maxCards: number = 3;

  for (const nevent of nevents.slice(0, maxCards)) {
    const card: HTMLDivElement = document.createElement("div");
    card.className = "border border-indigo-200 bg-indigo-50 rounded-lg p-3";
    card.textContent = "Loading referenced event...";
    container.appendChild(card);

    try {
      const decoded = nip19.decode(nevent);
      if (decoded.type !== "nevent") {
        card.textContent = "Referenced event is invalid.";
        continue;
      }

      const data: any = decoded.data;
      const eventId: string | undefined = data?.id || (typeof data === "string" ? data : undefined);
      const relayHints: string[] = Array.isArray(data?.relays) ? data.relays : [];
      if (!eventId) {
        card.textContent = "Referenced event ID is missing.";
        continue;
      }

      const relaysToUse: string[] = relayHints.length > 0 ? relayHints : currentRelays;
      const referencedEvent: NostrEvent | null = await fetchEventByIdCached(eventId, relaysToUse);
      if (!referencedEvent) {
        card.textContent = "Referenced event not found.";
        continue;
      }

      const referencedProfile: NostrProfile | null = await fetchProfile(referencedEvent.pubkey, relaysToUse);
      const referencedNpub: Npub = nip19.npubEncode(referencedEvent.pubkey);
      const referencedName: string = getDisplayName(referencedNpub, referencedProfile);
      const referencedAvatar: string = getAvatarURL(referencedEvent.pubkey, referencedProfile);
      const referencedText: string = referencedEvent.content.length > 180
        ? `${referencedEvent.content.slice(0, 180)}...`
        : referencedEvent.content;
      const referencedPath: string = `/${nevent}`;

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
