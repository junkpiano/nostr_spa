export function shortenNpub(npub) {
    return npub.slice(0, 12) + "...";
}
export function getAvatarURL(pubkey, profile) {
    return profile?.picture || `https://robohash.org/${pubkey}.png`;
}
export function getDisplayName(npub, profile) {
    return profile?.nip05 || profile?.name || shortenNpub(npub);
}
