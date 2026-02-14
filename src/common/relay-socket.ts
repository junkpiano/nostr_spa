import {
  recordRelayFailure,
  recordRelaySuccess,
} from '../features/relays/relays.js';

export function createRelayWebSocket(
  relayUrl: string,
  trackHealth: boolean = true,
): WebSocket {
  const socket: WebSocket = new WebSocket(relayUrl);
  if (trackHealth) {
    socket.addEventListener('open', (): void => {
      recordRelaySuccess(relayUrl);
    });
    socket.addEventListener('error', (): void => {
      recordRelayFailure(relayUrl);
    });
  }
  return socket;
}
