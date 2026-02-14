import type { PubkeyHex } from '../../types/nostr';

export type TimelineRemovalTarget =
  | { type: 'global' }
  | { type: 'home'; pubkey: PubkeyHex }
  | { type: 'user'; pubkey: PubkeyHex };

export function computeTimelineRemovalTargets(params: {
  viewerPubkey?: PubkeyHex | null;
  authorPubkey: PubkeyHex;
}): TimelineRemovalTarget[] {
  const targets: TimelineRemovalTarget[] = [{ type: 'global' }];
  if (params.viewerPubkey) {
    targets.push({ type: 'home', pubkey: params.viewerPubkey });
  }
  targets.push({ type: 'user', pubkey: params.authorPubkey });
  return targets;
}
