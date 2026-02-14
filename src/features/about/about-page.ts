import type { SetActiveNavFn } from '../../common/types.js';

interface AboutPageOptions {
  closeAllWebSockets: () => void;
  stopBackgroundFetch: () => void;
  clearNotification: () => void;
  setActiveNav: SetActiveNavFn;
  output: HTMLElement | null;
  profileSection: HTMLElement | null;
}

export function loadAboutPage(options: AboutPageOptions): void {
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
  const aboutButton: HTMLElement | null = document.getElementById('nav-about');
  options.setActiveNav(
    homeButton,
    globalButton,
    relaysButton,
    profileLink,
    settingsButton,
    null,
  );
  if (aboutButton) {
    aboutButton.classList.remove('text-gray-700');
    aboutButton.classList.add('bg-indigo-100', 'text-indigo-700');
  }

  const postsHeader: HTMLElement | null =
    document.getElementById('posts-header');
  if (postsHeader) {
    postsHeader.textContent = 'About noxtr';
    postsHeader.style.display = '';
  }

  if (options.profileSection) {
    options.profileSection.innerHTML = '';
    options.profileSection.className = '';
  }

  if (!options.output) {
    return;
  }

  options.output.innerHTML = `
    <article class="space-y-6 text-sm text-gray-700 leading-relaxed">
      <section class="bg-white border border-gray-200 rounded-lg p-5">
        <h3 class="text-lg font-bold text-gray-900 mb-2">A Practical Nostr Client</h3>
        <p>
          noxtr is built as a fast single-page web client focused on reliability and day-to-day use.
          It keeps the protocol visible, avoids heavy abstractions, and gives you direct control over
          relays, identity, and timelines.
        </p>
      </section>

      <section class="bg-indigo-50 border border-indigo-200 rounded-lg p-5">
        <h3 class="text-base font-bold text-indigo-900 mb-3">What Makes noxtr Different</h3>
        <ul class="space-y-2 list-disc list-inside">
          <li><span class="font-semibold">Relay-first controls:</span> full relay list management, health checks, and one-click post broadcast to newly added relays.</li>
          <li><span class="font-semibold">Protocol-forward rendering:</span> native support for NIP-30 custom emoji in posts, reactions, and profile metadata.</li>
          <li><span class="font-semibold">Efficient timeline behavior:</span> background sync, timeline caching, and route guards to avoid stale updates during rapid navigation.</li>
          <li><span class="font-semibold">Performance mode:</span> energy-saving mode that replaces heavy inline media with lightweight links.</li>
          <li><span class="font-semibold">No lock-in identity model:</span> works with browser extension signing and local session key flow.</li>
          <li><span class="font-semibold">Readable event views:</span> reply context, referenced-event cards, and OGP preview support in one feed.</li>
        </ul>
      </section>

      <section class="bg-gray-50 border border-gray-200 rounded-lg p-5">
        <h3 class="text-base font-bold text-gray-900 mb-2">Design Goal</h3>
        <p>
          noxtr prioritizes transparency over magic: when something happens on the network, you can
          usually trace it in the UI. The goal is a client that stays simple enough to trust while
          still being capable enough for serious Nostr usage.
        </p>
      </section>
    </article>
  `;
}
