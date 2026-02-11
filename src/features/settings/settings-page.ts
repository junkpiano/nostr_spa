import { getEventCacheStats, clearEventCache } from "../../common/event-cache.js";
import { clearProfileCache, getProfileCacheStats } from "../profile/profile-cache.js";
import type { SetActiveNavFn } from "../../common/types.js";

interface SettingsPageOptions {
  closeAllWebSockets: () => void;
  stopBackgroundFetch: () => void;
  clearNotification: () => void;
  setActiveNav: SetActiveNavFn;
  output: HTMLElement | null;
  profileSection: HTMLElement | null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units: string[] = ["B", "KB", "MB", "GB"];
  let value: number = bytes;
  let unitIndex: number = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded: string = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

export function loadSettingsPage(options: SettingsPageOptions): void {
  options.closeAllWebSockets();
  options.stopBackgroundFetch();
  options.clearNotification();

  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
  const profileLink: HTMLElement | null = document.getElementById("nav-profile");
  const settingsButton: HTMLElement | null = document.getElementById("nav-settings");
  options.setActiveNav(homeButton, globalButton, relaysButton, profileLink, settingsButton, settingsButton);

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.textContent = "Settings";
    postsHeader.style.display = "";
  }

  if (options.profileSection) {
    options.profileSection.innerHTML = "";
    options.profileSection.className = "";
  }

  if (options.output) {
    options.output.innerHTML = `
      <div class="space-y-5 text-sm">
        <div class="text-gray-600">
          この端末に保存しているデータです。
        </div>
        <div class="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
          <div class="text-sm text-gray-800">
            保存データの合計: <span id="cache-size">計算中...</span>
          </div>
          <div class="text-xs text-gray-500 mt-1">
            投稿: <span id="cache-events">-</span> / プロフィール: <span id="cache-profiles">-</span>
          </div>
        </div>
        <button id="cache-clear"
          class="bg-red-100 hover:bg-red-200 text-red-700 font-semibold py-2 px-4 rounded-lg transition-colors w-full sm:w-auto">
          保存データを削除
        </button>
        <p id="cache-status" class="text-xs text-gray-500"></p>
      </div>
    `;
  }

  const sizeEl: HTMLElement | null = document.getElementById("cache-size");
  const eventsEl: HTMLElement | null = document.getElementById("cache-events");
  const profilesEl: HTMLElement | null = document.getElementById("cache-profiles");
  const statusEl: HTMLElement | null = document.getElementById("cache-status");
  const clearBtn: HTMLButtonElement | null = document.getElementById("cache-clear") as HTMLButtonElement | null;

  const updateStats = async (): Promise<void> => {
    const [eventStats, profileStats] = await Promise.all([getEventCacheStats(), getProfileCacheStats()]);
    const totalBytes: number = eventStats.bytes + profileStats.bytes;
    if (sizeEl) {
      sizeEl.textContent = formatBytes(totalBytes);
    }
    if (eventsEl) {
      eventsEl.textContent = `${eventStats.count}件`;
    }
    if (profilesEl) {
      profilesEl.textContent = `${profileStats.count}件`;
    }
  };

  updateStats().catch(() => {
    if (sizeEl) {
      sizeEl.textContent = "不明";
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", async (): Promise<void> => {
      if (!window.confirm("保存データを削除しますか？")) {
        return;
      }
      clearBtn.disabled = true;
      clearBtn.classList.add("opacity-60", "cursor-not-allowed");
      if (statusEl) {
        statusEl.textContent = "削除中...";
      }
      await Promise.all([clearEventCache(), clearProfileCache()]);
      await updateStats();
      if (statusEl) {
        statusEl.textContent = "削除しました。";
      }
      clearBtn.disabled = false;
      clearBtn.classList.remove("opacity-60", "cursor-not-allowed");
    });
  }
}
