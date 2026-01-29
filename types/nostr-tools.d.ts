// types/nostr-tools.d.ts
declare module "https://esm.sh/nostr-tools@2.17.0" {
  export namespace nip19 {
    export function decode(npub: string): { type: string; data: string };
    export function npubEncode(pubkey: string): string;
  }
}
