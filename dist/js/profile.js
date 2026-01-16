import { getAvatarURL, getDisplayName } from "./utils.js";
export async function fetchProfile(pubkeyHex, relays) {
    let profile = null;
    for (const relayUrl of relays) {
        try {
            const socket = new WebSocket(relayUrl);
            await new Promise((resolve, reject) => {
                socket.onopen = () => {
                    const subId = "profile-" + Math.random().toString(36).slice(2);
                    const req = [
                        "REQ",
                        subId,
                        { kinds: [0], authors: [pubkeyHex], limit: 1 }
                    ];
                    socket.send(JSON.stringify(req));
                };
                socket.onmessage = (msg) => {
                    const arr = JSON.parse(msg.data);
                    if (arr[0] === "EVENT" && arr[2]?.kind === 0) {
                        try {
                            profile = JSON.parse(arr[2].content);
                        }
                        catch (e) {
                            console.warn("Failed to parse profile JSON", e);
                        }
                        socket.close();
                        resolve();
                    }
                    else if (arr[0] === "EOSE") {
                        socket.close();
                        reject(new Error("No profile found"));
                    }
                };
                socket.onerror = (err) => {
                    console.error(`WebSocket error [${relayUrl}]`, err);
                    reject(err);
                };
            });
            break; // If success, stop trying others
        }
        catch (e) {
            console.warn(`Failed to fetch profile from ${relayUrl}, trying next...`);
        }
    }
    return profile;
}
export function renderProfile(pubkey, npub, profile, profileSection) {
    const avatar = getAvatarURL(pubkey, profile);
    const name = getDisplayName(npub, profile);
    profileSection.innerHTML = `
    <div class="flex flex-col items-center">
      <img src="${avatar}" alt="Avatar" class="w-20 h-20 rounded-full object-cover mb-2"
        onerror="this.src='https://placekitten.com/100/100';" />
      <h2 class="font-bold text-lg">${name}</h2>
      ${profile?.about ? `<p class="text-gray-600 text-sm mt-1">${profile.about}</p>` : ""}
    </div>
  `;
}
