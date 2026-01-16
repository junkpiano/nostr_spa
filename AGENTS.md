# AGENTS.md - Nostr SPA TypeScript Development Guide

This guide provides essential information for agentic coding assistants working on the Nostr SPA TypeScript project.

## Project Overview
A single-page application for viewing Nostr profiles and posts, built with Node.js/Express backend and TypeScript frontend using ES6 modules.

## Build/Lint/Test Commands

### Running the Application
```bash
# Build TypeScript and start the server
npm start

# Server runs on http://localhost:3000 by default
# Uses environment variable PORT if set
```

### Development Mode
```bash
# Watch mode for TypeScript compilation (if nodemon is installed)
npm run dev
```

### Building
```bash
# Compile TypeScript to JavaScript in dist/
npm run build
```

### Testing
Currently no test framework is configured. To add testing:

```bash
# Recommended: Add Jest for unit testing
npm install --save-dev jest @types/jest

# Run all tests (after setup)
npm test

# Run single test file
npm test -- path/to/test/file.test.ts

# Run tests in watch mode
npm test -- --watch

# Run specific test by name
npm test -- --testNamePattern="test name"
```

### Linting & Formatting
Currently no linting/formatting tools configured. Recommended setup:

```bash
# Install ESLint and Prettier for TypeScript
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier eslint-plugin-prettier

# Lint TypeScript code
npm run lint

# Format code
npm run format

# Fix linting issues automatically
npm run lint:fix
```

### Docker
```bash
# Build Docker image (compiles TypeScript during build)
docker build -t nostr-app-ts .

# Run Docker container
docker run -p 3000:3000 nostr-app-ts
```

## Code Style Guidelines

### TypeScript/JavaScript Standards

#### Imports and Exports
- Use ES6 modules exclusively (`import`/`export`)
- Group imports: external libraries first, then internal modules, then types
- Use named exports for utilities, default exports for main components
- Import types with `import type` when possible
- Example:
```typescript
import { nip19 } from "https://esm.sh/nostr-tools";
import express, { Request, Response } from "express";
import { fetchProfile, renderProfile } from "./profile.js";
import type { NostrProfile, PubkeyHex, Npub } from "../types/nostr.js";
```

#### Variables and Constants
- Use explicit type annotations for all variables
- Use `const` for immutable values, `let` for mutable variables
- Use descriptive, camelCase naming: `userProfile`, `eventList`, `relayConnection`
- Initialize variables at declaration when possible
- Example:
```typescript
const relays: string[] = ["wss://nos.lol", "wss://relay.damus.io"];
let seenEventIds: Set<string> = new Set();
let profile: NostrProfile | null = null;
```

#### Functions and Classes
- Use explicit return types for all functions
- Use arrow functions for concise expressions and callbacks
- Use `async/await` for asynchronous operations over Promises
- Name functions descriptively: `fetchProfile`, `renderEvent`, `validateNpub`
- Keep functions focused on single responsibilities
- Example:
```typescript
export async function fetchProfile(pubkeyHex: PubkeyHex, relays: string[]): Promise<NostrProfile | null> {
  // Implementation
}

export function renderEvent(event: NostrEvent, profile: NostrProfile | null, npub: Npub, pubkey: PubkeyHex, output: HTMLElement): void {
  // Implementation
}
```

#### Type Definitions
- Define comprehensive interfaces for complex data structures
- Use union types for optional/null values
- Use branded types for domain-specific strings (PubkeyHex, Npub)
- Export all types from a central types file
- Example:
```typescript
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export type PubkeyHex = string;
export type Npub = string;
```

#### Error Handling
- Use try/catch blocks for async operations
- Provide meaningful error messages
- Log errors to console for debugging
- Return appropriate HTTP status codes in API endpoints
- Use proper error types and interfaces
- Example:
```typescript
try {
  const response = await fetch(url);
  const data = await response.json();
  return data;
} catch (error) {
  console.error("Error fetching data:", error);
  throw new Error("Failed to fetch data");
}
```

#### Code Formatting
- Use 2-space indentation
- Use single quotes for strings
- Add trailing commas in multi-line objects/arrays
- Use template literals for string interpolation
- Break long lines appropriately (aim for <100 characters)
- Use explicit type annotations
- Example:
```typescript
const userCard: string = `
  <div class="user-profile">
    <img src="${avatar}" alt="Avatar" />
    <h3>${name}</h3>
  </div>
`;
```

### Frontend-Specific Guidelines

#### DOM Manipulation
- Use modern DOM APIs (`querySelector`, `addEventListener`)
- Cache DOM element references with explicit types
- Use event delegation when appropriate
- Clean up event listeners when components are removed
- Use null checks for DOM elements
- Example:
```typescript
const output: HTMLElement | null = document.getElementById("nostr-output");
const loadMoreBtn: HTMLElement | null = document.getElementById("load-more");

if (loadMoreBtn) {
  loadMoreBtn.addEventListener("click", handleLoadMore);
}
```

#### HTML Generation
- Use template literals for dynamic HTML generation
- Include proper semantic HTML structure
- Add accessibility attributes (alt, aria-labels)
- Use Tailwind CSS classes consistently
- Sanitize user input before rendering
- Example:
```typescript
const eventHTML: string = `
  <div class="bg-white rounded-lg p-4 shadow">
    <div class="flex items-start space-x-4">
      <img src="${avatar}" alt="User avatar" class="w-12 h-12 rounded-full" />
      <div class="flex-1">
        <div class="font-semibold">${name}</div>
        <div class="text-gray-700">${content}</div>
      </div>
    </div>
  </div>
`;
```

#### CSS/Styling
- Use Tailwind CSS utility classes
- Follow mobile-first responsive design principles
- Use semantic color classes (text-gray-700, bg-blue-500)
- Maintain consistent spacing with Tailwind's space scale
- Example:
```html
<div class="bg-white p-4 sm:p-6 rounded-lg shadow-md">
  <h2 class="text-xl sm:text-2xl font-semibold mb-4">Posts</h2>
</div>
```

### Backend/API Guidelines

#### Express Server Setup
- Use ES6 import syntax for modules
- Set up proper middleware for static file serving
- Handle CORS if needed for API endpoints
- Use environment variables for configuration
- Use explicit types for request/response objects
- Example:
```typescript
import express, { Request, Response } from "express";
import path from "path";

const app = express();
const port: string | number = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.get("/api/data", async (req: Request, res: Response): Promise<void> => {
  // Implementation
});
```

#### API Response Format
- Return JSON for API endpoints with explicit types
- Include proper HTTP status codes
- Provide consistent error response format
- Use generic types for flexible responses
- Example:
```typescript
// Success response
res.json({ data: result, success: true });

// Error response
res.status(400).json({ error: "Invalid input", success: false });
```

### Nostr Protocol Integration

#### Key Management
- Use nostr-tools library for key operations
- Handle npub encoding/decoding properly with type safety
- Validate pubkey formats before use
- Use branded types for better type safety
- Example:
```typescript
import { nip19 } from "https://esm.sh/nostr-tools";

try {
  const decoded = nip19.decode(npub);
  const pubkeyHex: PubkeyHex = decoded.data;
} catch (error) {
  throw new Error("Invalid npub format");
}
```

#### Relay Connections
- Use WebSocket connections for relay communication
- Handle connection errors gracefully
- Implement reconnection logic if needed
- Close connections when no longer needed
- Use proper error handling and typing
- Example:
```typescript
const socket: WebSocket = new WebSocket(relayUrl);
socket.onmessage = (msg: MessageEvent): void => {
  try {
    const data = JSON.parse(msg.data);
    // Process data
  } catch (error) {
    console.error("Failed to parse relay message:", error);
  }
};
```

### File Organization
- Keep server code in root (`server.ts`)
- Frontend TypeScript code in `/src/` directory
- Compiled JavaScript in `/dist/` directory
- Type definitions in `/types/` directory
- HTML template in `/src/` directory
- Follow naming conventions: `app.ts`, `utils.ts`, `events.ts`

### Security Best Practices
- Validate all user inputs with explicit type checking
- Sanitize HTML content before rendering
- Use HTTPS in production
- Avoid exposing sensitive data in client-side code
- Implement proper error handling without leaking internal details
- Use branded types to prevent type confusion

### Performance Considerations
- Minimize DOM manipulations
- Use efficient data structures (Sets for unique IDs)
- Implement pagination for large data sets
- Lazy load images and content
- Cache API responses when appropriate
- Use proper TypeScript compilation targets for browser compatibility

### TypeScript Configuration
- Use strict mode with all strict checks enabled
- Target ES2020 for modern browser support
- Use ESNext modules for tree shaking
- Enable exact optional property types
- Skip library checking for faster compilation
- Include only necessary files in compilation

### Git Workflow
- Write clear, descriptive commit messages
- Commit related changes together
- Use feature branches for new functionality
- Test changes before committing
- Example commit messages:
  - `feat: add profile fetching functionality`
  - `fix: handle WebSocket connection errors`
  - `refactor: convert JavaScript to TypeScript`

## Development Workflow
1. Edit TypeScript files in `src/` directory
2. Run `npm run build` to compile to `dist/`
3. Run `npm start` to build and run the server
4. Test in browser at localhost:3000
5. Add tests for new functionality
6. Run linting/formatting before committing

## Dependencies
- `express`: Web server framework
- `typescript`: TypeScript compiler
- `@types/node`: Node.js type definitions
- `@types/express`: Express type definitions
- `nostr-tools`: Nostr protocol utilities (loaded via ESM)

## Future Improvements
- Add testing framework (Jest + Testing Library)
- Add linting/formatting (ESLint + Prettier for TypeScript)
- Add build optimizations (Webpack/Vite for bundling)
- Add error monitoring and logging
- Add caching layer for performance
- Consider adding React/Vue for better component structure