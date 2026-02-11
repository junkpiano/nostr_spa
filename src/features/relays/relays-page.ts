import type { SetActiveNavFn } from "../../common/types.js";

interface RelaysPageOptions {
  closeAllWebSockets: () => void;
  stopBackgroundFetch: () => void;
  clearNotification: () => void;
  setActiveNav: SetActiveNavFn;
  getRelays: () => string[];
  setRelays: (relays: string[]) => void;
  normalizeRelayUrl: (rawUrl: string) => string | null;
  onRelaysChanged: () => void;
  profileSection: HTMLElement | null;
  output: HTMLElement | null;
}

export function loadRelaysPage(options: RelaysPageOptions): void {
  options.closeAllWebSockets();
  options.stopBackgroundFetch();
  options.clearNotification();

  const homeButton: HTMLElement | null = document.getElementById("nav-home");
  const globalButton: HTMLElement | null = document.getElementById("nav-global");
  const relaysButton: HTMLElement | null = document.getElementById("nav-relays");
  const profileLink: HTMLElement | null = document.getElementById("nav-profile");
  options.setActiveNav(homeButton, globalButton, relaysButton, profileLink, relaysButton);

  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.textContent = "Relay Management";
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
          Manage the relays used for fetching profiles and timelines. Changes are saved in your browser.
        </div>
        <div class="flex flex-col sm:flex-row gap-2">
          <input id="relay-input" type="text" placeholder="wss://relay.example.com"
            class="border border-gray-300 rounded-lg px-4 py-2 flex-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button id="relay-add"
            class="bg-gradient-to-r from-slate-800 via-indigo-900 to-purple-950 hover:from-slate-900 hover:via-indigo-950 hover:to-purple-950 text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow-lg">
            Add Relay
          </button>
        </div>
        <p id="relay-error" class="text-sm text-red-600"></p>
        <div id="relay-list" class="space-y-2"></div>
      </div>
    `;
  }

  const relayInput: HTMLInputElement | null = document.getElementById("relay-input") as HTMLInputElement;
  const relayAddButton: HTMLElement | null = document.getElementById("relay-add");
  const relayError: HTMLElement | null = document.getElementById("relay-error");
  const relayListEl: HTMLElement | null = document.getElementById("relay-list");

  let currentRelays: string[] = options.getRelays();
  let relayStatusSockets: WebSocket[] = [];
  let relayStatusTimeouts: number[] = [];

  function setError(message: string): void {
    if (relayError) {
      relayError.textContent = message;
    }
  }

  function clearError(): void {
    if (relayError) {
      relayError.textContent = "";
    }
  }

  function renderRelayList(): void {
    if (!relayListEl) return;
    relayListEl.innerHTML = "";
    relayStatusSockets.forEach((socket: WebSocket): void => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    });
    relayStatusSockets = [];
    relayStatusTimeouts.forEach((timeoutId: number): void => {
      clearTimeout(timeoutId);
    });
    relayStatusTimeouts = [];

    if (currentRelays.length === 0) {
      const empty: HTMLDivElement = document.createElement("div");
      empty.className = "text-gray-500";
      empty.textContent = "No relays configured.";
      relayListEl.appendChild(empty);
      return;
    }

    currentRelays.forEach((relayUrl: string, index: number): void => {
      const row: HTMLDivElement = document.createElement("div");
      row.className = "flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2";

      const urlText: HTMLSpanElement = document.createElement("span");
      urlText.className = "font-mono text-xs sm:text-sm text-gray-800 break-all";
      urlText.textContent = relayUrl;

      const status: HTMLSpanElement = document.createElement("span");
      status.className = "text-xs font-semibold px-2 py-1 rounded-full bg-gray-200 text-gray-700";
      status.textContent = "Checking...";

      const actions: HTMLDivElement = document.createElement("div");
      actions.className = "flex gap-2 items-center";

      const editBtn: HTMLButtonElement = document.createElement("button");
      editBtn.className = "px-3 py-1 text-xs font-semibold rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", (): void => {
        clearError();
        const updatedRaw: string | null = window.prompt("Edit relay URL:", relayUrl);
        if (updatedRaw === null) return;
        const normalized: string | null = options.normalizeRelayUrl(updatedRaw);
        if (!normalized) {
          setError("Invalid relay URL. Use ws:// or wss://");
          return;
        }
        const isDuplicate: boolean = currentRelays.some((url: string, i: number): boolean => url === normalized && i !== index);
        if (isDuplicate) {
          setError("This relay is already in the list.");
          return;
        }
        currentRelays[index] = normalized;
        options.setRelays(currentRelays);
        options.onRelaysChanged();
        renderRelayList();
      });

      const deleteBtn: HTMLButtonElement = document.createElement("button");
      deleteBtn.className = "px-3 py-1 text-xs font-semibold rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", (): void => {
        clearError();
        currentRelays = currentRelays.filter((_: string, i: number): boolean => i !== index);
        options.setRelays(currentRelays);
        options.onRelaysChanged();
        renderRelayList();
      });

      actions.appendChild(status);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      row.appendChild(urlText);
      row.appendChild(actions);
      relayListEl.appendChild(row);

      checkRelayStatus(relayUrl, status);
    });
  }

  function checkRelayStatus(relayUrl: string, statusEl: HTMLElement): void {
    const socket: WebSocket = new WebSocket(relayUrl);
    relayStatusSockets.push(socket);

    const timeoutId = window.setTimeout((): void => {
      statusEl.className = "text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700";
      statusEl.textContent = "Timeout";
      socket.close();
    }, 5000);
    relayStatusTimeouts.push(timeoutId);

    socket.onopen = (): void => {
      clearTimeout(timeoutId);
      statusEl.className = "text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700";
      statusEl.textContent = "Online";
      socket.close();
    };

    socket.onerror = (): void => {
      clearTimeout(timeoutId);
      statusEl.className = "text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700";
      statusEl.textContent = "Offline";
      socket.close();
    };
  }

  if (relayAddButton) {
    relayAddButton.addEventListener("click", (): void => {
      clearError();
      if (!relayInput) return;
      const normalized: string | null = options.normalizeRelayUrl(relayInput.value);
      if (!normalized) {
        setError("Invalid relay URL. Use ws:// or wss://");
        return;
      }
      if (currentRelays.includes(normalized)) {
        setError("This relay is already in the list.");
        return;
      }
      currentRelays = [...currentRelays, normalized];
      options.setRelays(currentRelays);
      options.onRelaysChanged();
      relayInput.value = "";
      renderRelayList();
    });
  }

  if (relayInput) {
    relayInput.addEventListener("keypress", (e: KeyboardEvent): void => {
      if (e.key === "Enter" && relayAddButton) {
        relayAddButton.click();
      }
    });
  }

  renderRelayList();
}
