import { nip19, getPublicKey } from 'nostr-tools';
import type { PubkeyHex, Npub } from "../../types/nostr";

let sessionPrivateKey: Uint8Array | null = null;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex length");
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return new Uint8Array(bytes);
}

function parsePrivateKey(rawKey: string): Uint8Array {
  if (rawKey.startsWith("nsec")) {
    const decoded = nip19.decode(rawKey);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid nsec format");
    }
    const data = decoded.data;
    return typeof data === "string" ? hexToBytes(data) : data;
  }

  if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new Error("Private key must be nsec or 64 hex chars");
  }
  return hexToBytes(rawKey);
}

export function setSessionPrivateKeyFromRaw(rawKey: string): PubkeyHex {
  const secretBytes: Uint8Array = parsePrivateKey(rawKey);
  sessionPrivateKey = secretBytes;
  return getPublicKey(secretBytes);
}

export function clearSessionPrivateKey(): void {
  sessionPrivateKey = null;
}

export function getSessionPrivateKey(): Uint8Array | null {
  return sessionPrivateKey;
}

export function updateLogoutButton(composeButton: HTMLElement | null): void {
  const logoutButton: HTMLElement | null = document.getElementById("nav-logout");
  const profileLink: HTMLAnchorElement | null = document.getElementById("nav-profile") as HTMLAnchorElement;
  const storedPubkey: string | null = localStorage.getItem("nostr_pubkey");

  if (logoutButton) {
    if (storedPubkey) {
      logoutButton.style.display = "";
    } else {
      logoutButton.style.display = "none";
    }
  }

  if (profileLink) {
    if (storedPubkey) {
      try {
        const npub: Npub = storedPubkey.startsWith("npub")
          ? (storedPubkey as Npub)
          : nip19.npubEncode(storedPubkey);
        profileLink.href = `/${npub}`;
      } catch (e) {
        console.warn("Failed to build profile link from stored pubkey:", e);
        profileLink.href = "#";
      }
    } else {
      profileLink.href = "#";
    }
  }

  if (composeButton) {
    if (storedPubkey) {
      composeButton.style.display = "";
    } else {
      composeButton.style.display = "none";
    }
  }
}
