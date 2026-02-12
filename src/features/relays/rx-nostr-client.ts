import { createRxNostr, createRxBackwardReq, type RxNostr } from 'rx-nostr';
import { verifyEvent } from 'nostr-tools';
import { getRelays, recordRelayFailure, recordRelaySuccess } from './relays.js';

let rxNostr: RxNostr | null = null;

/**
 * Get or create the global RxNostr instance
 */
export function getRxNostr(): RxNostr {
  if (!rxNostr) {
    rxNostr = createRxNostr({
      skipFetchNip11: true,
      skipVerify: false,
      verifier: async (event) => verifyEvent(event),
    });

    // Set up relay monitoring
    rxNostr.createConnectionStateObservable().subscribe({
      next: (packet) => {
        if (packet.state === 'connected') {
          recordRelaySuccess(packet.from);
        } else if (packet.state === 'error') {
          recordRelayFailure(packet.from);
        }
      },
    });
  }

  return rxNostr;
}

/**
 * Synchronize relay connections with current relay list
 */
export function syncRelayConnections(): void {
  const client = getRxNostr();
  const currentRelays = getRelays();

  // Update relay connections
  client.setDefaultRelays(currentRelays);
}

/**
 * Create a backward REQ for fetching historical events
 */
export function createBackwardReq(subId?: string) {
  return createRxBackwardReq(subId || `sub-${Math.random().toString(36).slice(2)}`);
}

/**
 * Cleanup and dispose the RxNostr instance (call on app shutdown)
 */
export function disposeRxNostr(): void {
  if (rxNostr) {
    rxNostr.dispose();
    rxNostr = null;
  }
}

// Initialize with current relays
syncRelayConnections();

// Listen for relay updates
if (typeof window !== 'undefined') {
  window.addEventListener('relays-updated', syncRelayConnections);
}
