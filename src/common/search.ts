export function setupSearchBar(output: HTMLElement | null): void {
  const searchButton: HTMLElement | null = document.getElementById('search-button');
  const clearSearchButton: HTMLElement | null = document.getElementById('clear-search-button');
  const searchInput: HTMLInputElement | null = document.getElementById(
    'search-input',
  ) as HTMLInputElement;

  function performSearch(): void {
    if (searchInput && output) {
      const query: string = searchInput.value.trim().toLowerCase();
      if (!query) {
        clearSearch();
        return;
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

    if (output) {
      const eventContainers: NodeListOf<HTMLElement> = output.querySelectorAll('.event-container');
      eventContainers.forEach((container: HTMLElement): void => {
        container.style.display = '';
      });
    }

    if (clearSearchButton) {
      clearSearchButton.style.display = 'none';
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
    searchButton.addEventListener('click', performSearch);
  }

  if (clearSearchButton) {
    clearSearchButton.addEventListener('click', clearSearch);
  }

  if (searchInput) {
    searchInput.addEventListener('keypress', (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        performSearch();
      }
    });

    searchInput.addEventListener('input', (): void => {
      const query: string = searchInput.value.trim();
      if (query === '') {
        clearSearch();
      }
    });
  }
}
