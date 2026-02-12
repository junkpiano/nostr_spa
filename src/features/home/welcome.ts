import type { PubkeyHex } from "../../../types/nostr";

interface ShowInputFormOptions {
  output: HTMLElement | null;
  profileSection: HTMLElement | null;
  composeButton: HTMLElement | null;
  updateLogoutButton: (composeButton: HTMLElement | null) => void;
  clearSessionPrivateKey: () => void;
  setSessionPrivateKeyFromRaw: (rawKey: string) => PubkeyHex;
  handleRoute: () => void;
}

export async function showInputForm(options: ShowInputFormOptions): Promise<void> {
  const postsHeader: HTMLElement | null = document.getElementById("posts-header");
  if (postsHeader) {
    postsHeader.style.display = "none";
  }

  if (options.profileSection) {
    options.profileSection.innerHTML = "";
    options.profileSection.className = "";
  }

  if (!options.output) {
    return;
  }

  options.output.innerHTML = `
      <div class="text-center py-12">
        <h2 class="text-2xl font-bold text-gray-800 mb-4">Welcome to noxtr</h2>
        <p class="text-gray-600 mb-6">Connect your Nostr extension or use your private key to view your home timeline,<br/>or explore the global timeline.</p>
        <div class="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <button id="welcome-login" class="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-lg">
            🔑 Connect Extension
          </button>
          <button id="welcome-global" class="bg-gradient-to-r from-slate-800 via-indigo-900 to-purple-950 hover:from-slate-900 hover:via-indigo-950 hover:to-purple-950 text-white font-semibold py-3 px-6 rounded-lg transition-colors shadow-lg">
            🌍 View Global Timeline
          </button>
        </div>
        <div class="mt-6 max-w-xl mx-auto text-left space-y-2">
          <label for="private-key-input" class="block text-sm font-semibold text-gray-700">Private Key (nsec or 64 hex)</label>
          <div class="flex flex-col sm:flex-row gap-2">
            <input id="private-key-input" type="password" autocomplete="off" placeholder="nsec1... or hex"
              class="border border-gray-300 rounded-lg px-4 py-2 w-full text-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button id="private-key-login"
              class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow-lg">
              Use Private Key
            </button>
          </div>
          <p class="text-xs text-gray-500">Private keys are stored temporarily in your browser session (cleared when you close the browser). For better security, use a Nostr extension instead.</p>
        </div>
      </div>
    `;

  const welcomeLoginBtn: HTMLElement | null = document.getElementById("welcome-login");
  const welcomeGlobalBtn: HTMLElement | null = document.getElementById("welcome-global");
  const privateKeyLoginBtn: HTMLElement | null = document.getElementById("private-key-login");
  const privateKeyInput: HTMLInputElement | null = document.getElementById("private-key-input") as HTMLInputElement;

  if (welcomeLoginBtn) {
    welcomeLoginBtn.addEventListener("click", async (): Promise<void> => {
      try {
        if (!(window as any).nostr) {
          alert("No Nostr extension found!\n\nPlease install a Nostr browser extension like:\n- Alby (getalby.com)\n- nos2x\n- Flamingo\n\nThen reload this page.");
          return;
        }

        const pubkeyHex: string = await (window as any).nostr.getPublicKey();
        if (!pubkeyHex) {
          alert("Failed to get public key from extension.");
          return;
        }

        localStorage.setItem("nostr_pubkey", pubkeyHex);
        options.clearSessionPrivateKey();
        options.updateLogoutButton(options.composeButton);
        window.history.pushState(null, "", "/home");
        options.handleRoute();
      } catch (error: unknown) {
        console.error("Extension login error:", error);
        if (error instanceof Error) {
          alert(`Failed to connect with extension: ${error.message}`);
        } else {
          alert("Failed to connect with extension. Please make sure your extension is unlocked and try again.");
        }
      }
    });
  }

  if (welcomeGlobalBtn) {
    welcomeGlobalBtn.addEventListener("click", (): void => {
      window.history.pushState(null, "", "/global");
      options.handleRoute();
    });
  }

  if (privateKeyLoginBtn) {
    privateKeyLoginBtn.addEventListener("click", (): void => {
      try {
        if (!privateKeyInput) return;
        const rawKey: string = privateKeyInput.value.trim();
        if (!rawKey) {
          alert("Please enter your private key.");
          return;
        }
        const pubkeyHex: PubkeyHex = options.setSessionPrivateKeyFromRaw(rawKey);
        localStorage.setItem("nostr_pubkey", pubkeyHex);
        privateKeyInput.value = "";
        options.updateLogoutButton(options.composeButton);
        window.history.pushState(null, "", "/home");
        options.handleRoute();
      } catch (error: unknown) {
        console.error("Private key login error:", error);
        options.clearSessionPrivateKey();
        if (error instanceof Error) {
          alert(`Failed to use private key: ${error.message}`);
        } else {
          alert("Failed to use private key.");
        }
      }
    });
  }

  if (privateKeyInput) {
    privateKeyInput.addEventListener("keypress", (e: KeyboardEvent): void => {
      if (e.key === "Enter" && privateKeyLoginBtn) {
        privateKeyLoginBtn.click();
      }
    });
  }
}
