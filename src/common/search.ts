export function setupSearchBar(output: HTMLElement | null): void {
  const searchButton: HTMLElement | null = document.getElementById('search-button');
  const clearSearchButton: HTMLElement | null = document.getElementById('clear-search-button');
  const searchInput: HTMLInputElement | null = document.getElementById(
    'search-input',
  ) as HTMLInputElement;

  // Mobile search elements
  const searchButtonMobile: HTMLElement | null = document.getElementById('search-button-mobile');
  const clearSearchButtonMobile: HTMLElement | null = document.getElementById('clear-search-button-mobile');
  const searchInputMobile: HTMLInputElement | null = document.getElementById(
    'search-input-mobile',
  ) as HTMLInputElement;
  const searchOverlay: HTMLElement | null = document.getElementById('search-overlay');

  function performSearch(fromMobile: boolean = false): void {
    const activeInput = fromMobile && searchInputMobile ? searchInputMobile : searchInput;

    if (activeInput && output) {
      const query: string = activeInput.value.trim().toLowerCase();
      if (!query) {
        clearSearch();
        return;
      }

      // Sync inputs
      if (searchInput && searchInputMobile) {
        searchInput.value = query;
        searchInputMobile.value = query;
      }

      const eventContainers: NodeListOf<HTMLElement> = output.querySelectorAll('.event-container');
      let matchCount: number = 0;

      eventContainers.forEach((container: HTMLElement): void => {
        const contentDiv: HTMLElement | null = container.querySelector('.whitespace-pre-wrap');
        if (contentDiv) {
          const content: string = contentDiv.textContent?.toLowerCase() || '';
          if (content.includes(query)) {
            container.style.display = '';
            matchCount++;
          } else {
            container.style.display = 'none';
          }
        }
      });

      if (clearSearchButton) {
        clearSearchButton.style.display = '';
      }

      if (clearSearchButtonMobile) {
        clearSearchButtonMobile.style.display = '';
      }

      // Close mobile search overlay after search
      if (fromMobile && searchOverlay) {
        searchOverlay.style.display = 'none';
      }

      const postsHeader: HTMLElement | null = document.getElementById('posts-header');
      if (postsHeader) {
        postsHeader.textContent = `Search Results (${matchCount})`;
      }
    }
  }

  function clearSearch(): void {
    if (searchInput) {
      searchInput.value = '';
    }

    if (searchInputMobile) {
      searchInputMobile.value = '';
    }

    if (output) {
      const eventContainers: NodeListOf<HTMLElement> = output.querySelectorAll('.event-container');
      eventContainers.forEach((container: HTMLElement): void => {
        container.style.display = '';
      });
    }

    if (clearSearchButton) {
      clearSearchButton.style.display = 'none';
    }

    if (clearSearchButtonMobile) {
      clearSearchButtonMobile.style.display = 'none';
    }

    const postsHeader: HTMLElement | null = document.getElementById('posts-header');
    if (postsHeader) {
      const path: string = window.location.pathname;
      if (path === '/global') {
        postsHeader.textContent = 'Global Timeline';
      } else if (path === '/home') {
        postsHeader.textContent = 'Home Timeline';
      } else if (path === '/relays') {
        postsHeader.textContent = 'Relay Management';
      } else {
        postsHeader.textContent = 'Posts:';
      }
    }
  }

  if (searchButton) {
    searchButton.addEventListener('click', (): void => performSearch(false));
  }

  if (clearSearchButton) {
    clearSearchButton.addEventListener('click', clearSearch);
  }

  if (searchInput) {
    searchInput.addEventListener('keypress', (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        performSearch(false);
      }
    });

    searchInput.addEventListener('input', (): void => {
      const query: string = searchInput.value.trim();
      if (query === '') {
        clearSearch();
      }
    });
  }

  // Mobile search event listeners
  if (searchButtonMobile) {
    searchButtonMobile.addEventListener('click', (): void => performSearch(true));
  }

  if (clearSearchButtonMobile) {
    clearSearchButtonMobile.addEventListener('click', (): void => {
      clearSearch();
      if (searchOverlay) {
        searchOverlay.style.display = 'none';
      }
    });
  }

  if (searchInputMobile) {
    searchInputMobile.addEventListener('keypress', (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        performSearch(true);
      }
    });

    searchInputMobile.addEventListener('input', (): void => {
      const query: string = searchInputMobile.value.trim();
      if (query === '') {
        clearSearch();
      }
    });
  }
}
