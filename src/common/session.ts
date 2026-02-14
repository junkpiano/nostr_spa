import { getPublicKey, nip19 } from 'nostr-tools';
import type { Npub, PubkeyHex } from '../../types/nostr';

let sessionPrivateKey: Uint8Array | null = null;

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

  // Store in sessionStorage so it persists across page reloads (but not browser sessions)
  try {
    sessionStorage.setItem('nostr_private_key', bytesToHex(secretBytes));
  } catch (error: unknown) {
    console.warn('Failed to persist private key in sessionStorage:', error);
  }

  return getPublicKey(secretBytes);
}

export function clearSessionPrivateKey(): void {
  sessionPrivateKey = null;
  try {
    sessionStorage.removeItem('nostr_private_key');
  } catch (error: unknown) {
    console.warn('Failed to clear private key from sessionStorage:', error);
  }
}

export function getSessionPrivateKey(): Uint8Array | null {
  // Return cached value if available
  if (sessionPrivateKey) {
    return sessionPrivateKey;
  }

  // Try to restore from sessionStorage
  try {
    const storedHex: string | null =
      sessionStorage.getItem('nostr_private_key');
    if (storedHex) {
      sessionPrivateKey = hexToBytes(storedHex);
      return sessionPrivateKey;
    }
  } catch (error: unknown) {
    console.warn('Failed to restore private key from sessionStorage:', error);
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
