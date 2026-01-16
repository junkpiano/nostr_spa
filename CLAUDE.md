# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-page Nostr profile viewer built with Express backend and vanilla TypeScript frontend. Users can view Nostr profiles and posts by navigating to `/{npub}` URLs. The app queries multiple Nostr relays in parallel via WebSocket and displays results in real-time.

## Build & Development Commands

```bash
# Build TypeScript to dist/ and start server
npm start

# Development mode (TypeScript watch + nodemon)
npm run dev

# Build only (compile TypeScript, copy HTML, reorganize output)
npm run build

# Docker
docker build -t nostr-app .
docker run -p 3000:3000 nostr-app
```

The server runs on http://localhost:3000 by default (or PORT environment variable).

## Architecture Overview

### Module Structure

The codebase is organized into modular TypeScript files:

- **[server.ts](server.ts)** - Express server that serves static files and provides `/api/ogp` endpoint for fetching Open Graph metadata
- **[src/app.ts](src/app.ts)** - Main entry point; handles URL routing, initializes app with npub from URL path
- **[src/profile.ts](src/profile.ts)** - Fetches and renders Nostr profiles (kind 0 events)
- **[src/events.ts](src/events.ts)** - Fetches and renders Nostr posts (kind 1 events) with pagination
- **[src/utils.ts](src/utils.ts)** - Helper functions for display names, avatars, npub formatting
- **[types/nostr.ts](types/nostr.ts)** - TypeScript interfaces for Nostr protocol types
- **[types/nostr-tools.d.ts](types/nostr-tools.d.ts)** - Type definitions for nostr-tools ESM import

### Data Flow

1. User navigates to `/{npub}` URL
2. `app.ts` parses npub from URL path
3. Decodes npub to hex pubkey using nostr-tools
4. Fetches profile metadata (kind 0) from relays via `profile.ts`
5. Renders profile information
6. Fetches posts (kind 1) from relays via `events.ts`
7. Renders posts with automatic link/image detection
8. "Load More" button fetches older posts using pagination

### Relay Communication Pattern

The app uses a **parallel multi-relay strategy**:
- Opens WebSocket connections to 5+ relays simultaneously
- Sends same REQ subscription to each relay
- Deduplicates events by ID using a `Set<string>`
- Uses "until" timestamp for pagination (fetches events older than last seen)
- Closes connections after EOSE (end of stored events) message

### Build Process

The build script performs these steps:
1. Compile TypeScript: `tsc` (outputs to dist/)
2. Copy HTML: `cp src/index.html dist/`
3. Reorganize JS: `mkdir -p dist/js && cp dist/src/*.js dist/js/`
4. Cleanup: `rm -rf dist/src dist/types`

**Important**: Frontend imports use `.js` extensions (not `.ts`) because they reference compiled output.

### Module System

- Uses **ES6 modules** throughout (`type: "module"` in package.json)
- Frontend loads nostr-tools from CDN: `import { nip19 } from "https://esm.sh/nostr-tools"`
- All imports in TypeScript source must use `.js` extension for compiled compatibility
- No bundler; browser loads modules natively

### TypeScript Configuration

Strict mode enabled with all strictness flags:
- `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`
- `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- Target ES2020 for modern browser support
- ESNext modules for tree shaking

## Key Implementation Details

### URL Routing
- Client-side routing via URL pathname
- Empty path shows input form
- `/{npub}` path loads that profile
- Server.ts has catch-all route that returns index.html for SPA behavior

### Event Pagination
- Uses `untilTimestamp` to track the oldest event loaded
- "Load More" button passes this timestamp to fetch earlier events
- Each new batch updates `untilTimestamp` to the oldest event in that batch

### Deduplication
- `seenEventIds: Set<string>` tracks all event IDs across all relays
- Events from multiple relays with same ID are filtered out
- Set persists across pagination to avoid duplicates when loading more

### Error Handling
- Profile fetch tries relays sequentially until one succeeds
- WebSocket errors are logged but don't block other relays
- Fallback avatar URLs (robohash.org) if profile has no picture
- Timeout after 3 seconds if no events found

### Content Rendering
- Auto-detects URLs in post content
- Renders images inline if URL ends with image extension
- Converts other URLs to clickable links
- Uses template literals for HTML generation
- Tailwind CSS for styling

## Nostr Protocol Specifics

- **Kind 0**: Profile metadata (name, picture, about, nip05, etc.)
- **Kind 1**: Text notes/posts
- **npub**: Bech32-encoded public key (user-facing format)
- **pubkey hex**: Hex-encoded public key (protocol format)
- **NIP-19**: Encoding spec for npub/note identifiers
- **Relay**: WebSocket server that stores and serves Nostr events
- **REQ**: Subscription message with filters
- **EVENT**: Message containing a Nostr event
- **EOSE**: End of stored events (relay has sent all matching events)

## Type Safety

All functions have explicit return types. Use branded types for domain-specific strings:
- `PubkeyHex`: Hex-encoded public key
- `Npub`: Bech32-encoded public key
- `EventId`: Event identifier

DOM elements are null-checked before use. All async operations use try/catch.

## Relay Configuration

Default relays defined in [src/app.ts:10-14](src/app.ts#L10-L14):
```typescript
const relays: string[] = [
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.damus.io",
  "wss://nostr.wine",
  "wss://relay.snort.social"
];
```

More relays can be added to this array for increased redundancy and speed.
