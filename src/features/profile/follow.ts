import { finalizeEvent } from 'nostr-tools';
import { createRelayWebSocket } from "../../common/relay-socket.js";
import { recordRelayFailure } from "../relays/relays.js";
import { fetchFollowList } from '../../common/events-queries.js';
import { getSessionPrivateKey } from '../../common/session.js';
import type { NostrEvent, PubkeyHex } from '../../../types/nostr';

interface FollowToggleOptions {
  getRelays: () => string[];
  publishEvent: (event: NostrEvent, relayList: string[]) => Promise<void>;
  onFollowListChanged?: () => void;
}

export async function setupFollowToggle(
  targetPubkey: PubkeyHex,
  options: FollowToggleOptions,
): Promise<void> {
  const container: HTMLElement | null = document.getElementById('follow-action');
  if (!container) return;

  const storedPubkey: string | null = localStorage.getItem('nostr_pubkey');
  if (!storedPubkey || storedPubkey === targetPubkey) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <button id="follow-toggle" class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow">
      Follow
    </button>
  `;

  const button: HTMLButtonElement | null = document.getElementById('follow-toggle') as HTMLButtonElement;
  if (!button) return;

  const hasSigningCapability = (): boolean => {
    const hasExtension: boolean = Boolean((window as any).nostr && (window as any).nostr.signEvent);
    const hasPrivateKey: boolean = Boolean(getSessionPrivateKey());
    return hasExtension || hasPrivateKey;
  };

  let isFollowing: boolean = false;
  let followList: PubkeyHex[] = [];

  try {
    followList = await fetchFollowList(storedPubkey as PubkeyHex, options.getRelays());
    isFollowing = followList.includes(targetPubkey);
  } catch (e) {
    console.warn('Failed to load follow list for toggle', e);
  }

  const updateButton = (): void => {
    if (!hasSigningCapability()) {
      button.textContent = 'Follow (sign-in required)';
      button.className =
        'bg-slate-500 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow';
      return;
    }

    if (isFollowing) {
      button.textContent = 'Unfollow';
      button.className =
        'bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow';
    } else {
      button.textContent = 'Follow';
      button.className =
        'bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors shadow';
    }
  };

  updateButton();

  button.addEventListener('click', async (): Promise<void> => {
    if (!hasSigningCapability()) {
      alert('Sign-in required to follow. Please log in with extension or private key.');
      return;
    }

    button.disabled = true;
    button.classList.add('opacity-60', 'cursor-not-allowed');

    try {
      followList = await fetchFollowList(storedPubkey as PubkeyHex, options.getRelays());
      const followSet: Set<PubkeyHex> = new Set(followList);
      if (isFollowing) {
        followSet.delete(targetPubkey);
      } else {
        followSet.add(targetPubkey);
      }

      const tags: string[][] = Array.from(followSet).map(
        (pubkey: PubkeyHex): string[] => ['p', pubkey],
      );
      const unsignedEvent: Omit<NostrEvent, 'id' | 'sig'> = {
        kind: 3,
        pubkey: storedPubkey as PubkeyHex,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: '',
      };

      let signedEvent: NostrEvent;
      if ((window as any).nostr && (window as any).nostr.signEvent) {
        signedEvent = await (window as any).nostr.signEvent(unsignedEvent);
      } else {
        const privateKey: Uint8Array | null = getSessionPrivateKey();
        if (!privateKey) {
          throw new Error('No signing method available');
        }
        signedEvent = finalizeEvent(unsignedEvent, privateKey) as NostrEvent;
      }
      await options.publishEvent(signedEvent, options.getRelays());

      isFollowing = !isFollowing;
      updateButton();
      if (options.onFollowListChanged) {
        options.onFollowListChanged();
      }
    } catch (error: unknown) {
      console.error('Failed to update follow list:', error);
      alert('Failed to update follow list. Please try again.');
    } finally {
      button.disabled = false;
      button.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  });
}

export async function publishEventToRelays(
  event: NostrEvent,
  relayList: string[],
): Promise<void> {
  const promises = relayList.map(async (relayUrl: string): Promise<void> => {
    try {
      const socket: WebSocket = createRelayWebSocket(relayUrl);
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          recordRelayFailure(relayUrl);
          socket.close();
          resolve();
        }, 5000);

        socket.onopen = (): void => {
          socket.send(JSON.stringify(['EVENT', event]));
        };

        socket.onmessage = (msg: MessageEvent): void => {
          const arr: any[] = JSON.parse(msg.data);
          if (arr[0] === 'OK') {
            clearTimeout(timeout);
            socket.close();
            resolve();
          }
        };

        socket.onerror = (): void => {
          clearTimeout(timeout);
          socket.close();
          resolve();
        };
      });
    } catch (e) {
      console.warn(`Failed to publish event to ${relayUrl}:`, e);
    }
  });

  await Promise.allSettled(promises);
}
