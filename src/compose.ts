import { finalizeEvent } from "https://esm.sh/nostr-tools@2.17.0";
import type { NostrEvent, PubkeyHex } from "../types/nostr";

interface ComposeOverlayOptions {
  composeButton: HTMLElement | null;
  getSessionPrivateKey: () => Uint8Array | null;
  getRelays: () => string[];
  publishEvent: (event: NostrEvent, relays: string[]) => Promise<void>;
  refreshTimeline: () => Promise<void>;
}

export function setupComposeOverlay(options: ComposeOverlayOptions): void {
  const overlay: HTMLElement | null = document.getElementById("compose-overlay");
  const backdrop: HTMLElement | null = document.getElementById("compose-overlay-backdrop");
  const closeBtn: HTMLElement | null = document.getElementById("compose-overlay-close");
  const textarea: HTMLTextAreaElement | null = document.getElementById("compose-textarea") as HTMLTextAreaElement;
  const submitBtn: HTMLButtonElement | null = document.getElementById("compose-submit") as HTMLButtonElement;
  const statusEl: HTMLElement | null = document.getElementById("compose-status");

  if (!overlay || !backdrop || !closeBtn || !textarea || !submitBtn || !statusEl) {
    return;
  }

  const openOverlay = (): void => {
    overlay.style.display = "";
    textarea.focus();
  };

  const closeOverlay = (): void => {
    overlay.style.display = "none";
    statusEl.textContent = "";
  };

  const refreshStatus = (): void => {
    const hasExtension: boolean = Boolean((window as any).nostr && (window as any).nostr.signEvent);
    const hasPrivateKey: boolean = Boolean(options.getSessionPrivateKey());
    if (hasExtension) {
      statusEl.textContent = "Signing with extension";
    } else if (hasPrivateKey) {
      statusEl.textContent = "Signing with private key (session)";
    } else {
      statusEl.textContent = "Sign-in required to post";
    }

    if (!hasExtension && !hasPrivateKey) {
      submitBtn.disabled = true;
      submitBtn.classList.add("opacity-60", "cursor-not-allowed");
    } else {
      submitBtn.disabled = false;
      submitBtn.classList.remove("opacity-60", "cursor-not-allowed");
    }
  };

  if (options.composeButton) {
    options.composeButton.addEventListener("click", (): void => {
      refreshStatus();
      openOverlay();
    });
  }

  backdrop.addEventListener("click", closeOverlay);
  closeBtn.addEventListener("click", closeOverlay);

  document.addEventListener("keydown", (event: KeyboardEvent): void => {
    if (overlay.style.display === "none") return;
    if (event.key === "Escape") {
      closeOverlay();
    }
  });

  submitBtn.addEventListener("click", async (): Promise<void> => {
    if (!textarea.value.trim()) {
      textarea.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add("opacity-60", "cursor-not-allowed");
    statusEl.textContent = "Posting...";

    try {
      const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");
      if (!storedPubkey) {
        throw new Error("Not logged in");
      }

      const unsignedEvent: Omit<NostrEvent, "id" | "sig"> = {
        kind: 1,
        pubkey: storedPubkey as PubkeyHex,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: textarea.value.trim(),
      };

      let signedEvent: NostrEvent;
      if ((window as any).nostr && (window as any).nostr.signEvent) {
        signedEvent = await (window as any).nostr.signEvent(unsignedEvent);
      } else {
        const privateKey: Uint8Array | null = options.getSessionPrivateKey();
        if (!privateKey) {
          throw new Error("No signing method available");
        }
        signedEvent = finalizeEvent(unsignedEvent, privateKey) as NostrEvent;
      }

      await options.publishEvent(signedEvent, options.getRelays());
      textarea.value = "";
      statusEl.textContent = "Posted";
      closeOverlay();
      await options.refreshTimeline();
    } catch (error: unknown) {
      console.error("Failed to post:", error);
      statusEl.textContent = "Failed to post";
      alert("Failed to post. Please try again.");
    } finally {
      refreshStatus();
    }
  });
}
