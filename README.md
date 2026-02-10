# noxtr (Developer README)

Nostr SPA built with TypeScript + Vite.
This README is for developers working on this repository.

## Stack

- TypeScript (strict mode)
- Vite
- Tailwind CSS
- nostr-tools (via ESM import)
- Browser WebSocket API (relay access)

## Local Development

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Run dev server

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Preview production build

```bash
npm run preview
```

## Project Layout

```text
src/
  app.ts              # App orchestration, routing, timeline state
  events.ts           # Home/global timeline loading logic
  events-queries.ts   # Follow list, event fetch, delete checks
  event-render.ts     # Event card rendering, OGP, delete action, nevent reference cards
  home-loader.ts      # Initial home timeline loader
  event-page.ts       # nevent page loader
  welcome.ts          # Login/welcome screen flow
  follow.ts           # Follow/unfollow + publish helper
  relays.ts           # Relay config storage/helpers
  relays-page.ts      # Relay management page UI
  compose.ts          # Compose overlay + shortcuts
  overlays.ts         # Image overlay
  search.ts           # In-page post search
  navigation.ts       # Nav setup + active state
  profile.ts          # Profile fetch/render
  meta.ts             # Dynamic OG/Twitter meta tags
  utils.ts            # Shared utility functions
  main.ts             # App entrypoint
  index.html
  styles.css

types/
  nostr.ts
  nostr.js
  nostr-tools.d.ts
```

## Key Behavior Notes

- Follow list uses the latest kind `3` event across configured relays.
- Event page checks author delete events (kind `5`) before rendering.
- Own posts show a delete button that publishes kind `5`.
- `nostr:nevent...` references are rendered as embedded mini cards.
- OGP and Twitter embed fetches are cached in-memory by URL.

## NPM Scripts

```json
{
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview"
}
```

## Current Tooling Status

- No test framework configured yet.
- No ESLint/Prettier pipeline configured yet.

## Development Guidelines

- Keep edits in `src/` and run `npm run build` before committing.
- Prefer small modules; avoid large files when adding features.
- Preserve existing TypeScript style (explicit types, clear null checks).
- For relay/network behavior changes, test with multiple relay configurations.
