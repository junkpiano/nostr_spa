// types/nostr-tools.d.ts
declare module "https://esm.sh/nostr-tools@2.17.0" {
  export namespace nip19 {
    export function decode(npub: string): { type: string; data: string | Uint8Array };
    export function npubEncode(pubkey: string): string;
    export function neventEncode(data: { id: string; relays?: string[]; author?: string; kind?: number }): string;
  }

  export function getPublicKey(secretKey: Uint8Array): string;
  export function finalizeEvent(event: any, secretKey: Uint8Array): any;
}
