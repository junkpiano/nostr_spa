import { fetchFollowList } from "../../common/events-queries.js";
import { loadHomeTimeline } from "./home-timeline.js";
import type { PubkeyHex } from "../../../types/nostr";

interface LoadUserHomeTimelineOptions {
  pubkeyHex: PubkeyHex;
  relays: string[];
  output: HTMLElement | null;
  profileSection: HTMLElement | null;
  connectingMsg: HTMLElement | null;
  homeKinds: number[];
  limit: number;
  seenEventIds: Set<string>;
  activeWebSockets: WebSocket[];
  activeTimeouts: number[];
  setUntilTimestamp: (value: number) => void;
  setNewestEventTimestamp: (value: number) => void;
  setCachedHomeTimeline: (followedWithSelf: PubkeyHex[], seen: Set<string>) => void;
  startBackgroundFetch: (followedWithSelf: PubkeyHex[]) => void;
}

export async function loadUserHomeTimeline(options: LoadUserHomeTimelineOptions): Promise<void> {
  try {
    if (options.output) {
      options.output.innerHTML = `
        <div class="text-center py-12">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p class="text-gray-700 font-semibold">Fetching your follow list...</p>
          <p class="text-gray-500 text-sm mt-2">This may take a few seconds</p>
        </div>
      `;
    }

    const postsHeader: HTMLElement | null = document.getElementById("posts-header");
    if (postsHeader) {
      postsHeader.textContent = "Home Timeline";
      postsHeader.style.display = "";
    }

    if (options.profileSection) {
      options.profileSection.innerHTML = "";
      options.profileSection.className = "";
    }

    const followedPubkeys: PubkeyHex[] = await fetchFollowList(options.pubkeyHex, options.relays);
    const followedWithSelf: PubkeyHex[] = Array.from(new Set([...followedPubkeys, options.pubkeyHex]));

    if (options.output) {
      options.output.innerHTML = `
        <div class="text-center py-12">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p class="text-gray-700 font-semibold">Loading posts from ${followedPubkeys.length} people...</p>
        </div>
      `;
    }

    if (options.output) {
      options.seenEventIds.clear();
      const now: number = Math.floor(Date.now() / 1000);
      options.setUntilTimestamp(now);
      options.setNewestEventTimestamp(now);
      await loadHomeTimeline(
        followedWithSelf,
        options.homeKinds,
        options.relays,
        options.limit,
        now,
        options.seenEventIds,
        options.output,
        options.connectingMsg,
        options.activeWebSockets,
        options.activeTimeouts,
      );

      options.setCachedHomeTimeline(followedWithSelf, options.seenEventIds);
      options.startBackgroundFetch(followedWithSelf);
    }
  } catch (error: unknown) {
    console.error("Error loading home timeline:", error);
    localStorage.removeItem("nostr_pubkey");

    if (options.output) {
      options.output.innerHTML = `
        <div class="text-center py-8">
          <p class="text-red-600 mb-4">Failed to load home timeline.</p>
          <p class="text-gray-600 text-sm mb-4">Please try connecting your extension again.</p>
        </div>
      `;
    }
    throw error;
  }
}
