# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-page Nostr client built with Vite and vanilla TypeScript. Users can view their home timeline, explore the global timeline, and search posts. The app queries multiple Nostr relays in parallel via WebSocket and displays results in real-time with client-side routing.

## Development Workflow: Architect-Worker Pattern

**Claude Code acts as the Architect, Codex MCP as the Worker.**

When Codex MCP is available, follow this pattern:

1. **Claude Code (Architect) responsibilities:**
   - Understand the user's requirements and clarify ambiguities
   - Design the system architecture and technical approach
   - Define functional requirements (what the system should do)
   - Define non-functional requirements (performance, security, maintainability)
   - Specify interfaces, data models, and module boundaries
   - Identify files to be modified or created
   - Make architectural decisions and document rationale
   - Review Codex's implementation for architectural consistency

2. **Codex MCP (Worker) responsibilities:**
   - Implement the specifications provided by Claude Code
   - Write code according to the architectural design
   - Follow coding standards and patterns specified
   - Handle implementation details and edge cases
   - Execute repetitive or routine coding tasks

3. **Communication protocol:**
   - Claude Code provides Codex with:
     - Clear system design documentation
     - Functional specifications (features, behaviors, use cases)
     - Non-functional specifications (performance targets, error handling, validation rules)
     - File structure and module organization
     - API contracts and data schemas
     - Code style and patterns to follow
   - Codex implements the design and reports back
   - Claude Code reviews, provides feedback, and iterates if needed

4. **When to use Codex:**
   - Large-scale feature implementations
   - Multi-file refactoring with clear specifications
   - Repetitive code generation (similar components, CRUD operations)
   - Implementation of well-defined APIs or modules

5. **When Claude Code should implement directly:**
   - Quick fixes or small changes
   - Architectural explorations or prototypes
   - Situations requiring real-time user clarification
   - Critical sections requiring careful judgment

**Example usage:**
```
User: "Add a feature to filter posts by hashtags"

Claude Code (Architect):
1. Clarifies requirements with user (UI placement, filter behavior, etc.)
2. Designs the solution:
   - Add hashtag extraction function in utils.ts
   - Modify event rendering to display hashtags as clickable links
   - Add filter state management in app.ts
   - Update UI with filter chips in index.html
   - Define data flow: click hashtag → update filter → re-render timeline
3. Provides detailed specs to Codex MCP
4. Reviews Codex's implementation for correctness and consistency
```

## Build & Development Commands

```bash
# Development mode with Vite dev server
npm run dev

# Build for production (Vite build)
npm run build

# Preview production build locally
npm run preview

# Docker (multi-stage build with nginx)
docker build -t nostr-app .
docker run -p 8080:80 nostr-app
```

The dev server runs on http://localhost:5173 by default. The production Docker container runs on port 80 (nginx).

## Architecture Overview

### Module Structure

The codebase is organized into feature folders with shared modules:

- **[src/app/main.ts](src/app/main.ts)** - Vite entry point (imports app.ts)
- **[src/app/app.ts](src/app/app.ts)** - Main application logic; handles client-side routing (/home, /global, /{npub}), timeline management, and navigation
- **[src/features/profile/profile.ts](src/features/profile/profile.ts)** - Fetches and renders Nostr profiles (kind 0 events)
- **[src/features/profile/profile-events.ts](src/features/profile/profile-events.ts)** - Profile post loading (kind 1) with pagination
- **[src/features/global/global-timeline.ts](src/features/global/global-timeline.ts)** - Global timeline loading logic
- **[src/features/home/home-timeline.ts](src/features/home/home-timeline.ts)** - Home timeline loading logic
- **[src/common/event-render.ts](src/common/event-render.ts)** - Event card rendering, OGP, delete action, nevent reference cards
- **[src/common/events-queries.ts](src/common/events-queries.ts)** - Follow list, event fetch, delete checks
- **[src/utils/utils.ts](src/utils/utils.ts)** - Helper functions for display names, avatars, OGP metadata, Twitter embeds
- **[src/index.html](src/index.html)** - HTML template with navigation, timeline container, and search sidebar
- **[types/nostr.ts](types/nostr.ts)** - TypeScript interfaces for Nostr protocol types
- **[vite.config.ts](vite.config.ts)** - Vite configuration with Tailwind CSS integration

### Data Flow

**Home Timeline (logged in users):**
1. User connects via NIP-07 browser extension (Alby, nos2x, etc.)
2. App fetches user's follow list (kind 3 event) from relays
3. Loads posts (kind 1) from followed users via `features/home/home-timeline.ts`
4. Background polling checks for new posts every 30 seconds
5. Displays notification when new posts are available

**Global Timeline:**
1. Fetches recent posts (kind 1) from all users across relays
2. Dynamically loads profiles for post authors
3. Caches profiles to avoid refetching

**Profile View (/{npub}):**
1. Parses npub from URL path
2. Decodes npub to hex pubkey using nostr-tools
3. Fetches profile metadata (kind 0) from relays via `features/profile/profile.ts`
4. Renders profile with avatar, banner, and bio
5. Fetches user's posts (kind 1) from relays via `features/profile/profile-events.ts`
6. "Load More" button fetches older posts using pagination

### Relay Communication Pattern

The app uses a **parallel multi-relay strategy**:
- Opens WebSocket connections to 5+ relays simultaneously
- Sends same REQ subscription to each relay
- Deduplicates events by ID using a `Set<string>`
- Uses "until" timestamp for pagination (fetches events older than last seen)
- Closes connections after EOSE (end of stored events) message

### Build Process

Vite handles the build process:
1. Type-checks TypeScript files with `tsc --noEmit`
2. Bundles and optimizes code with Vite build
3. Processes Tailwind CSS (imported in app/main.ts)
4. Outputs optimized assets to `dist/` directory
5. Generates source maps for debugging

**Docker Build:**
- Stage 1: Builds the Vite app in a Node.js container
- Stage 2: Serves static files with nginx (alpine-based, ~25MB)
- nginx configured for SPA routing (all routes → index.html)

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
- Client-side routing via History API (`pushState`, `popstate`)
- `/` and `/home` - Home timeline (requires login) or welcome screen
- `/global` - Global timeline (public, no login required)
- `/{npub}` - Profile view for specific Nostr user
- Navigation updates URL and maintains browser history
- nginx serves index.html for all routes (SPA behavior)

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

Default relays defined in [src/features/relays/relays.ts](src/features/relays/relays.ts):
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
