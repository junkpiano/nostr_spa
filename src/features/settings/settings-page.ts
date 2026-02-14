import {
  clearEventCache,
  getEventCacheStats,
} from '../../common/event-cache.js';
import type { SetActiveNavFn } from '../../common/types.js';
import {
  clearProfileCache,
  getProfileCacheStats,
} from '../profile/profile-cache.js';

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
    return '0 B';
  }
  const units: string[] = ['B', 'KB', 'MB', 'GB'];
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

  const homeButton: HTMLElement | null = document.getElementById('nav-home');
  const globalButton: HTMLElement | null =
    document.getElementById('nav-global');
  const relaysButton: HTMLElement | null =
    document.getElementById('nav-relays');
  const profileLink: HTMLElement | null =
    document.getElementById('nav-profile');
  const settingsButton: HTMLElement | null =
    document.getElementById('nav-settings');
  options.setActiveNav(
    homeButton,
    globalButton,
    relaysButton,
    profileLink,
    settingsButton,
    settingsButton,
  );

  const postsHeader: HTMLElement | null =
    document.getElementById('posts-header');
  if (postsHeader) {
    postsHeader.textContent = 'Settings';
    postsHeader.style.display = '';
  }

  if (options.profileSection) {
    options.profileSection.innerHTML = '';
    options.profileSection.className = '';
  }

  if (options.output) {
    const isEnergySavingEnabled =
      localStorage.getItem('energy_saving_mode') === 'true';

    options.output.innerHTML = `
      <div class="space-y-6 text-sm">
        <!-- Energy Saving Mode Section -->
        <div class="bg-white border border-gray-200 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-semibold text-gray-900 mb-1">⚡ Energy Saving Mode</h3>
              <p class="text-xs text-gray-600">Images and videos will show as links instead of loading inline</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" id="energy-saving-toggle" class="sr-only peer" ${isEnergySavingEnabled ? 'checked' : ''}>
              <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>

        <!-- Cache Section -->
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

  const energySavingToggle: HTMLInputElement | null = document.getElementById(
    'energy-saving-toggle',
  ) as HTMLInputElement | null;
  const sizeEl: HTMLElement | null = document.getElementById('cache-size');
  const eventsEl: HTMLElement | null = document.getElementById('cache-events');
  const profilesEl: HTMLElement | null =
    document.getElementById('cache-profiles');
  const statusEl: HTMLElement | null = document.getElementById('cache-status');
  const clearBtn: HTMLButtonElement | null = document.getElementById(
    'cache-clear',
  ) as HTMLButtonElement | null;

  // Energy saving mode toggle
  if (energySavingToggle) {
    energySavingToggle.addEventListener('change', (): void => {
      const isEnabled = energySavingToggle.checked;
      localStorage.setItem('energy_saving_mode', isEnabled ? 'true' : 'false');

      // Dispatch event to notify the app
      window.dispatchEvent(
        new CustomEvent('energy-saving-changed', {
          detail: { enabled: isEnabled },
        }),
      );

      // Show feedback
      if (statusEl) {
        statusEl.textContent = isEnabled
          ? '⚡ Energy saving mode enabled'
          : 'Energy saving mode disabled';
        setTimeout((): void => {
          if (statusEl) {
            statusEl.textContent = '';
          }
        }, 3000);
      }
    });
  }

  const updateStats = async (): Promise<void> => {
    const [eventStats, profileStats] = await Promise.all([
      getEventCacheStats(),
      getProfileCacheStats(),
    ]);
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
      sizeEl.textContent = '不明';
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', async (): Promise<void> => {
      if (!window.confirm('保存データを削除しますか？')) {
        return;
      }
      clearBtn.disabled = true;
      clearBtn.classList.add('opacity-60', 'cursor-not-allowed');
      if (statusEl) {
        statusEl.textContent = '削除中...';
      }
      await Promise.all([clearEventCache(), clearProfileCache()]);
      await updateStats();
      if (statusEl) {
        statusEl.textContent = '削除しました。';
      }
      clearBtn.disabled = false;
      clearBtn.classList.remove('opacity-60', 'cursor-not-allowed');
    });
  }
}
