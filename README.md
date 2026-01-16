# Nostr SPA

A modern, lightweight Single Page Application for browsing Nostr profiles and posts. Built with TypeScript, Express, and vanilla JavaScript.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

## 🌟 Features

- **Decentralized Social Media**: Browse Nostr profiles and posts without centralized platforms
- **Real-time Updates**: Live loading of posts from multiple Nostr relays
- **Type-Safe**: Full TypeScript implementation with comprehensive type definitions
- **Responsive Design**: Mobile-friendly interface using Tailwind CSS
- **OGP Support**: Built-in Open Graph Protocol metadata fetching
- **Docker Ready**: Easy deployment with Docker containers
- **Fast Loading**: Optimized build process with TypeScript compilation

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd nostr-spa
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the application**
   ```bash
   npm start
   ```

4. **Open your browser**
   ```
   http://localhost:3000
   ```

## 📱 Usage

### Browsing Profiles

1. Navigate to `http://localhost:3000`
2. Enter a Nostr public key (npub format) or let the app generate a random profile
3. View the user's profile information and recent posts
4. Click "Load More" to fetch additional posts

### URL-based Navigation

You can also directly navigate to profiles using URLs:
```
http://localhost:3000/npub1...
```

## 🏗️ Architecture

### Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Frontend**: Vanilla JavaScript + TypeScript + ES6 Modules
- **Styling**: Tailwind CSS
- **Protocol**: Nostr (via nostr-tools)
- **Build**: TypeScript compiler
- **Container**: Docker

### Project Structure

```
nostr-spa/
├── src/                    # TypeScript source files
│   ├── index.html         # Main HTML template
│   ├── app.ts             # Main application logic
│   ├── events.ts          # Event loading and rendering
│   ├── profile.ts         # Profile management
│   └── utils.ts           # Utility functions
├── types/                 # TypeScript type definitions
│   ├── nostr.ts           # Nostr protocol types
│   └── nostr-tools.d.ts   # External library types
├── dist/                  # Compiled output (auto-generated)
├── server.ts              # Express server
├── tsconfig.json          # TypeScript configuration
├── Dockerfile             # Docker configuration
└── package.json           # Dependencies and scripts
```

## 🔧 Development

### Available Scripts

```bash
# Start development server (builds and runs)
npm start

# Build TypeScript to JavaScript
npm run build

# Development mode with watch (requires nodemon)
npm run dev
```

### Development Workflow

1. **Edit TypeScript files** in the `src/` directory
2. **Build the project** using `npm run build`
3. **Start the server** with `npm start`
4. **Test in browser** at `http://localhost:3000`

### Adding New Features

1. Create new TypeScript files in `src/`
2. Add corresponding type definitions in `types/`
3. Update the build process if needed
4. Test thoroughly with different Nostr keys

## 🐳 Docker Deployment

### Build and Run with Docker

```bash
# Build the Docker image
docker build -t nostr-spa .

# Run the container
docker run -p 3000:3000 nostr-spa
```

### Docker Configuration

The Dockerfile automatically:
- Installs all dependencies (including TypeScript)
- Compiles TypeScript during build
- Optimizes the image by removing dev dependencies
- Runs the compiled application

## 🔗 Nostr Integration

### Supported Relays

The application connects to multiple Nostr relays for redundancy:

- `wss://nos.lol`
- `wss://relay.nostr.band`
- `wss://relay.damus.io`
- `wss://nostr.wine`
- `wss://relay.snort.social`

### Event Types

Currently supports:
- **Kind 0**: User profiles and metadata
- **Kind 1**: Text posts and notes

### Type Safety

Comprehensive TypeScript interfaces ensure type safety when working with Nostr data:

```typescript
interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}
```

## 📡 API Endpoints

### OGP Metadata Fetcher

```
GET /api/ogp?url=<encoded-url>
```

Fetches Open Graph Protocol metadata for URLs mentioned in posts.

**Response:**
```json
{
  "og:title": "Page Title",
  "og:description": "Page description",
  "og:image": "https://example.com/image.jpg"
}
```

## 🤝 Contributing

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following the existing code style
4. **Add tests** if applicable
5. **Commit your changes**
   ```bash
   git commit -m "feat: add your feature description"
   ```
6. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Create a Pull Request**

### Code Style

- Use TypeScript with strict type checking
- Follow the existing naming conventions
- Add JSDoc comments for complex functions
- Ensure all code passes TypeScript compilation

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Nostr Protocol](https://github.com/nostr-protocol/nostr) - The decentralized social protocol
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) - JavaScript library for Nostr
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [Express.js](https://expressjs.com/) - Web application framework

## 🔮 Future Enhancements

- [ ] Add testing framework (Jest)
- [ ] Implement code linting (ESLint + Prettier)
- [ ] Add more event kinds support
- [ ] Implement caching for better performance
- [ ] Add dark mode support
- [ ] Create mobile app version
- [ ] Add search functionality
- [ ] Implement notifications for new posts

---

**Built with ❤️ for the decentralized web**