import { getPublicKey, nip19 } from 'nostr-tools';
import type { Npub, PubkeyHex } from '../../types/nostr';

let sessionPrivateKey: Uint8Array | null = null;
const PRIVATE_KEY_STORAGE_KEY: string = 'nostr_private_key';

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex length');
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return new Uint8Array(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte: number): string => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parsePrivateKey(rawKey: string): Uint8Array {
  if (rawKey.startsWith('nsec')) {
    const decoded = nip19.decode(rawKey);
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec format');
    }
    const data = decoded.data;
    return typeof data === 'string' ? hexToBytes(data) : data;
  }

  if (!/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new Error('Private key must be nsec or 64 hex chars');
  }
  return hexToBytes(rawKey);
}

export function setSessionPrivateKeyFromRaw(rawKey: string): PubkeyHex {
  const secretBytes: Uint8Array = parsePrivateKey(rawKey);
  sessionPrivateKey = secretBytes;

  // Store in localStorage so it persists across full app/browser restarts.
  try {
    localStorage.setItem(PRIVATE_KEY_STORAGE_KEY, bytesToHex(secretBytes));
  } catch (error: unknown) {
    console.warn('Failed to persist private key in localStorage:', error);
  }

  return getPublicKey(secretBytes);
}

export function clearSessionPrivateKey(): void {
  sessionPrivateKey = null;
  try {
    localStorage.removeItem(PRIVATE_KEY_STORAGE_KEY);
    sessionStorage.removeItem(PRIVATE_KEY_STORAGE_KEY);
  } catch (error: unknown) {
    console.warn('Failed to clear private key from storage:', error);
  }
}

export function getSessionPrivateKey(): Uint8Array | null {
  // Return cached value if available
  if (sessionPrivateKey) {
    return sessionPrivateKey;
  }

  // Try to restore from localStorage first (persistent login), then migrate any old sessionStorage value.
  try {
    const storedHex: string | null = localStorage.getItem(
      PRIVATE_KEY_STORAGE_KEY,
    );
    if (storedHex) {
      sessionPrivateKey = hexToBytes(storedHex);
      return sessionPrivateKey;
    }

    const legacySessionHex: string | null = sessionStorage.getItem(
      PRIVATE_KEY_STORAGE_KEY,
    );
    if (legacySessionHex) {
      sessionPrivateKey = hexToBytes(legacySessionHex);
      localStorage.setItem(PRIVATE_KEY_STORAGE_KEY, legacySessionHex);
      sessionStorage.removeItem(PRIVATE_KEY_STORAGE_KEY);
      return sessionPrivateKey;
    }
  } catch (error: unknown) {
    console.warn('Failed to restore private key from storage:', error);
  }

  return null;
}

export function updateLogoutButton(composeButton: HTMLElement | null): void {
  const logoutButton: HTMLElement | null =
    document.getElementById('nav-logout');
  const profileLink: HTMLAnchorElement | null = document.getElementById(
    'nav-profile',
  ) as HTMLAnchorElement;
  const storedPubkey: string | null = localStorage.getItem('nostr_pubkey');

  if (logoutButton) {
    if (storedPubkey) {
      logoutButton.style.display = '';
    } else {
      logoutButton.style.display = 'none';
    }
  }

  if (profileLink) {
    if (storedPubkey) {
      try {
        const npub: Npub = storedPubkey.startsWith('npub')
          ? (storedPubkey as Npub)
          : nip19.npubEncode(storedPubkey);
        profileLink.href = `/${npub}`;
      } catch (e) {
        console.warn('Failed to build profile link from stored pubkey:', e);
        profileLink.href = '#';
      }
    } else {
      profileLink.href = '#';
    }
  }

  if (composeButton) {
    if (storedPubkey) {
      composeButton.style.display = '';
    } else {
      composeButton.style.display = 'none';
    }
  }
}
