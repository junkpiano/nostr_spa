interface NavigationOptions {
  handleRoute: () => void;
  onLogout: () => void;
}

export function setActiveNav(
  homeButton: HTMLElement | null,
  globalButton: HTMLElement | null,
  relaysButton: HTMLElement | null,
  profileLink: HTMLElement | null,
  settingsButton: HTMLElement | null,
  activeButton: HTMLElement | null,
): void {
  if (homeButton) {
    homeButton.classList.remove('bg-indigo-100', 'text-indigo-700');
    homeButton.classList.add('text-gray-700');
  }
  if (globalButton) {
    globalButton.classList.remove('bg-indigo-100', 'text-indigo-700');
    globalButton.classList.add('text-gray-700');
  }
  if (relaysButton) {
    relaysButton.classList.remove('bg-indigo-100', 'text-indigo-700');
    relaysButton.classList.add('text-gray-700');
  }
  if (profileLink) {
    profileLink.classList.remove('bg-indigo-100', 'text-indigo-700');
    profileLink.classList.add('text-gray-700');
  }
  if (settingsButton) {
    settingsButton.classList.remove('bg-indigo-100', 'text-indigo-700');
    settingsButton.classList.add('text-gray-700');
  }

  if (activeButton) {
    activeButton.classList.remove('text-gray-700');
    activeButton.classList.add('bg-indigo-100', 'text-indigo-700');
  }
}

export function setupNavigation(options: NavigationOptions): void {
  const homeButton: HTMLElement | null = document.getElementById('nav-home');
  const globalButton: HTMLElement | null = document.getElementById('nav-global');
  const notificationsButton: HTMLElement | null = document.getElementById('nav-notifications');
  const relaysButton: HTMLElement | null = document.getElementById('nav-relays');
  const settingsButton: HTMLElement | null = document.getElementById('nav-settings');
  const logoutButton: HTMLElement | null = document.getElementById('nav-logout');

  if (homeButton) {
    homeButton.addEventListener('click', (): void => {
      window.history.pushState(null, '', '/home');
      options.handleRoute();
    });
  }

  if (globalButton) {
    globalButton.addEventListener('click', (): void => {
      window.history.pushState(null, '', '/global');
      options.handleRoute();
    });
  }

  if (notificationsButton) {
    notificationsButton.addEventListener('click', (): void => {
      window.history.pushState(null, '', '/notifications');
      options.handleRoute();
    });
  }

  if (relaysButton) {
    relaysButton.addEventListener('click', (): void => {
      window.history.pushState(null, '', '/relays');
      options.handleRoute();
    });
  }

  if (settingsButton) {
    settingsButton.addEventListener('click', (): void => {
      window.history.pushState(null, '', '/settings');
      options.handleRoute();
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', (): void => {
      options.onLogout();
      window.history.pushState(null, '', '/home');
      options.handleRoute();
    });
  }
}
