# Social Archiver for Obsidian

<div align="center">

![Social Archiver Logo](https://img.shields.io/badge/Obsidian-Social_Archiver-8B5CF6?style=for-the-badge&logo=obsidian)

**Save what matters.** Archive social media posts from 8 major platforms directly into your Obsidian vault.

[![GitHub release](https://img.shields.io/github/v/release/hyungyunlim/obsidian-social-archiver-releases?style=flat-square)](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)
[![License](https://img.shields.io/github/license/hyungyunlim/obsidian-social-archiver-releases?style=flat-square)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/hyungyunlim/obsidian-social-archiver-releases/total?style=flat-square)](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)

🚀 **Currently in Beta** - Unlimited free archiving for early adopters!

[Installation](#installation) • [Features](#features) • [Usage](#usage) • [Support](#support)

</div>

---

## 🎯 Overview

Social Archiver is a full-featured Obsidian plugin that transforms social media posts into permanent, searchable Markdown files in your vault. Built with modern web technologies and powered by Cloudflare infrastructure, it offers seamless archiving across desktop and mobile devices.

### Why Social Archiver?

- 🔒 **Data Ownership**: Your archived content stays in your vault, not on external servers
- 📱 **Mobile-First**: Optimized for both desktop and mobile with iOS/Android share extension support
- ⚡ **Real-Time Updates**: WebSocket-powered job processing with live progress updates
- 🎨 **Rich Timeline View**: Browse your archived posts in a beautiful, filterable timeline
- 🌐 **12 Platform Support**: Facebook, LinkedIn, Instagram, TikTok, X.com, Threads, YouTube, Reddit, Pinterest, Substack, Mastodon, and Bluesky
- 🚀 **Production-Ready**: Built with TypeScript strict mode, comprehensive test coverage, and SRP architecture

---

## ✨ Features

### Core Functionality

#### 🌐 Multi-Platform Support
Archive posts from 12 major social media platforms:

| Platform | Supported Content | Special Features |
|----------|------------------|------------------|
| **Facebook** | Posts, Photos, Videos | Full metadata extraction |
| **LinkedIn** | Posts, Articles | Professional network archiving |
| **Instagram** | Posts, Reels, Stories | Media optimization |
| **TikTok** | Videos | Transcript extraction, DRM fallback |
| **X.com / Twitter** | Tweets, Threads, Moments, Spaces | Thread unrolling |
| **Threads** | Posts | Meta platform integration |
| **YouTube** | Videos | Raw + formatted transcripts |
| **Reddit** | Posts, Comments | Nested comment preservation |
| **Pinterest** | Pins, Idea Pins | Category + hashtag capture |
| **Substack** | Notes & publication posts | Publication/author context, external link metadata |
| **Mastodon** | Posts, boosts, quotes | Instance-aware parsing, external link cards |
| **Bluesky** | Posts, threads, reposts | Quote-rich capture, embed extraction |

#### 📥 Advanced Archiving

- **Preliminary Document Creation**: Instant feedback with document created immediately while fetching in background
- **Async Job Processing**: Non-blocking architecture with retry logic (max 3 attempts)
- **Real-Time Updates**: WebSocket notifications when archives complete
- **Media Download Modes**:
  - `text-only` - No media downloads
  - `images-only` - Images only (optimized)
  - `images-and-videos` - Full media preservation
- **Link Preview Extraction**: Automatically extract and display up to 2 linked URLs per post
- **Embedded Archives**: Archive referenced posts (quote posts) with nested display
- **Smart Media Handling**: CORS proxy, image optimization, blob URL support for DRM content

#### 📝 Markdown Generation

- **YAML Frontmatter**: Rich metadata including platform, author, timestamps, credit usage
- **Platform-Specific Formatting**: Optimized display for each social network
- **Media Embedding**: Local image/video references with organized folder structure
- **YouTube Transcripts**: Both raw and formatted transcript options
- **Quoted Post Rendering**: Nested display of embedded archives

#### 🤖 AI Comments (Desktop Only)

Generate AI-powered comments on archived posts using locally-installed CLI tools:

- **Multiple AI Providers**: Claude Code, Gemini CLI, OpenAI Codex, or Ollama
- **Comment Types**: Summary, Key Points, Fact Check, Related Connections
- **Parallel Generation**: Generate with multiple AIs simultaneously
- **Custom Prompts**: Create and save your own prompt templates
- **Privacy Option**: Use Ollama for fully local, private generation
- **Smart Context**: Automatically includes vault context for better connections

> **Note**: This feature requires desktop Obsidian with CLI tools installed. Not available on iOS/Android. See [Network Usage Disclosure](#-network-usage-disclosure) for details.

#### 🎨 Timeline View

<details>
<summary>Timeline View Features (click to expand)</summary>

- **Custom Obsidian View**: Dedicated sidebar or full-screen timeline
- **Post Card UI**: Beautiful card-based layout with platform icons
- **Advanced Filtering**:
  - By platform (multi-select)
  - By date range
  - By archive status
- **Sorting Options**:
  - Published date
  - Archived date
  - Platform
- **Search**: Full-text search across post content
- **Inline Post Composer**: Create user posts directly in timeline
- **Automatic Refresh**: Updates when new archives complete

</details>

#### 🔐 Authentication & Security

- **Magic Link Auth**: Passwordless email authentication
- **JWT Tokens**: Secure token-based API access
- **Multi-Device Support**: Same account across desktop and mobile
- **Protocol Handler**: `obsidian://social-archive?token=...` for seamless auth flow
- **Device ID Tracking**: Multiple installations per account

#### ⚙️ Settings & Configuration

<details>
<summary>Comprehensive Settings (click to expand)</summary>

**General**
- Archive folder path (default: `Social Archives/{platform}/{year}/{month}/`)
- Media folder path (default: `attachments/social-archives/`)
- File naming format with tokens: `{date}`, `{platform}`, `{author}`, `{slug}`, `{id}`, `{shortId}`
- Download mode selection

**Timeline View**
- Default view mode (sidebar/main)
- Auto-refresh settings
- Filter preferences
- Post composer settings

**Authentication**
- Account status display
- Device management
- Magic link generation

**Usage Statistics**
- Credits used by platform
- Average timing metrics
- Storage usage

**Danger Zone**
- Clear cache
- Reset settings
- Delete account (coming soon)

</details>

---

## 🚀 Installation

### Option 1: Obsidian Community Plugins (Recommended)

> **Note**: Plugin is currently in beta review. Manual installation required until approved.

1. Open **Settings** → **Community Plugins** → **Browse**
2. Search for "**Social Archiver**"
3. Click **Install**, then **Enable**

### Option 2: Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` to:
   ```
   <your-vault>/.obsidian/plugins/social-archiver/
   ```
3. Reload Obsidian or enable in **Settings** → **Community Plugins**

---

## 📖 Usage

### 1️⃣ Account Setup

1. **Open Archive Modal** (Command Palette → "Social Archiver: Archive social media post" or click ribbon icon)
2. **Enter Email & Username** (first-time only)
3. **Verify Email** - Check inbox for magic link
4. **Click Magic Link** - Opens Obsidian with authentication token
5. **Start Archiving!** - You're ready to save posts

### 2️⃣ Archive a Post (Desktop)

**Method 1: Command Palette**
1. Copy post URL from any supported platform
2. Press `Cmd/Ctrl + P` → "Social Archiver: Archive social media post"
3. Paste URL and click **Archive**
4. Document created immediately, fetches in background

**Method 2: Clipboard Archive**
1. Copy post URL
2. Press `Cmd/Ctrl + P` → "Social Archiver: Archive from clipboard URL"
3. Confirms immediately if URL is valid

**Method 3: Timeline View**
1. Open Timeline View (Command Palette → "Open timeline view")
2. Click **+** button
3. Enter URL and archive

### 3️⃣ Archive a Post (Mobile)

**iOS Share Extension**
1. Open any social media app
2. Find post → Tap **Share**
3. Select **Obsidian** → **Social Archiver**
4. Post saved automatically to vault

**Android Share Extension**
1. Open any social media app
2. Find post → Tap **Share**
3. Select **Obsidian** → **Social Archiver**
4. Post saved automatically to vault

### 4️⃣ Browse Timeline

1. **Open Timeline View**:
   - Desktop: Sidebar by default (configurable)
   - Mobile: Full-screen mode
2. **Filter Posts**:
   - Click platform badges to filter
   - Use date range picker
   - Search by content
3. **Create User Post**:
   - Click **+** button
   - Write post in Markdown editor
   - Optionally share to public web

---

## 🏗️ Architecture

### Technology Stack

<details>
<summary>View Full Stack (click to expand)</summary>

#### Plugin (Obsidian)
- **Framework**: Obsidian Plugin API
- **UI**: Svelte 5 (Runes API)
- **Styling**: Tailwind CSS v3 (no preflight, Obsidian CSS variables)
- **Build**: Vite + esbuild
- **Validation**: Zod
- **HTTP**: Axios
- **Editor**: TipTap (Markdown)
- **Queue**: p-queue

#### Workers API (Cloudflare)
- **Framework**: Hono
- **Runtime**: Cloudflare Workers
- **Storage**: KV Store, D1 Database, Durable Objects
- **Real-Time**: WebSocket (Durable Objects)
- **Auth**: JWT (jose library)
- **Scraping**: BrightData API
- **CORS**: Multi-origin support

#### Share Web (Cloudflare Pages)
- **Framework**: SvelteKit
- **Adapter**: @sveltejs/adapter-cloudflare
- **Styling**: Tailwind CSS + Typography plugin
- **Rendering**: Static Site Generation (SSG)

</details>

### Service Architecture (SRP Compliant)

The plugin follows **Single Responsibility Principle** with 40+ specialized services:

- `ArchiveOrchestrator` - Coordinates full archive workflow
- `WorkersAPIClient` - API communication only
- `MarkdownConverter` - Markdown generation only
- `VaultManager` - Vault file operations only
- `MediaHandler` - Media download/optimization only
- `PendingJobsManager` - Job queue management only
- `RealtimeClient` - WebSocket connection only
- `LinkPreviewExtractor` - URL extraction only

[View Full Architecture Documentation](docs/ARCHITECTURE.md)

---

## 💰 Pricing

### 🎉 Beta (Current - FREE!)

- ✅ **Unlimited archives** during beta period
- ✅ All features unlocked
- ✅ No credit limits
- ✅ Early adopter benefits when we launch
- ✅ Help shape the product with feedback

### Post-Beta Plans

#### Free Plan
- **10 archives/month**
- Basic markdown conversion
- 30-day share link retention
- Standard support

#### Pro Plan - $19.99/month
- **500 archives/month**
- AI-powered analysis (coming soon)
- Permanent share links
- Priority support
- Custom domain for shares (coming soon)

**Credit Costs**
- Basic archive: 1 credit
- With AI analysis: 3 credits (coming soon)
- Deep research: 5 credits (coming soon)

> **Note**: The plugin is free and open-source. You only pay for API usage (archiving credits). Pro licenses are obtained externally via [Gumroad](https://gumroad.com) and activated in plugin settings.
>
> **Obsidian Policy Compliance**: This plugin is distributed for free per Obsidian's community plugin guidelines. External licensing for API services is permitted.

---

## 🔒 Privacy & Security

### Data We Collect
- ✅ **Email address** - For authentication only
- ✅ **Username** - Your unique identifier
- ✅ **Usage statistics** - Archive counts by platform (aggregated)
- ✅ **Timing metrics** - Performance data to improve service

### Data We DON'T Collect
- ❌ Your archived content (stays only in your vault)
- ❌ Social media passwords
- ❌ Personal browsing history
- ❌ Vault contents or file names

### Security Measures
- 🔐 **Magic link authentication** - No passwords to leak
- 🔒 **IP-based rate limiting** - 20 requests/hour protection
- 🌍 **HTTPS only** - All API calls encrypted
- ⏱️ **Temporary tokens** - Magic links expire in 15 minutes
- 🗑️ **Automatic cleanup** - Share links expire (30 days free, permanent pro)

### Compliance
- ✅ **GDPR Compliant** - EU data protection standards
- ✅ **Data minimization** - Only collect what's necessary
- ✅ **Right to deletion** - Contact us to delete account
- ✅ **Transparent processing** - Full privacy policy available

[Read Full Privacy Policy](PRIVACY.md)

---

## 🌐 Network Usage Disclosure

This plugin makes external network connections:

### Core Services (Required)
| Service | Purpose | Endpoint |
|---------|---------|----------|
| **Social Archiver API** | Post archiving & processing | `api.social-archive.org` |
| **BrightData** | Social media data collection | via Social Archiver API |
| **Cloudflare** | Infrastructure & CDN | `*.cloudflare.com` |

### AI Comment Feature (Desktop Only, Optional)
The AI comment feature uses locally-installed CLI tools that connect to external AI services:

| CLI Tool | Service | Endpoint | Privacy |
|----------|---------|----------|---------|
| **Claude Code** | Anthropic API | `api.anthropic.com` | Content sent to Anthropic |
| **Gemini CLI** | Google AI | `generativelanguage.googleapis.com` | Content sent to Google |
| **OpenAI Codex** | OpenAI API | `api.openai.com` | Content sent to OpenAI |
| **Ollama** | Local only | None (localhost) | ✅ Fully private |

**Important Notes:**
- AI comment features require locally-installed CLI tools and are **desktop-only**
- iOS and Android do not support AI comment generation
- Your archived content is sent to AI services when requesting AI comments
- For maximum privacy, use **Ollama** (runs entirely locally)
- Review each AI service's privacy policy before use

---

## 🛠️ Development

### Prerequisites

- Node.js 20.x or higher
- npm or yarn
- Git
- Obsidian (for testing)

### Quick Start

```bash
# Clone repository
git clone https://github.com/hyungyunlim/obsidian-social-archiver-releases.git
cd obsidian-social-archiver

# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build

# Run tests
npm test

# Type checking
npm run typecheck

# Lint
npm run lint
```

### Local Testing

<details>
<summary>Development Workflow (click to expand)</summary>

#### 1. Build and Deploy to Test Vault

```bash
# Build once and copy to test vault
npm run build:deploy

# Or build and watch for changes
npm run dev
```

#### 2. Enable in Obsidian

1. Open test vault in Obsidian
2. **Settings** → **Community Plugins**
3. Find "**Social Archiver**" and enable
4. Click **Reload** after code changes

#### 3. Custom Test Vault

Default test vault location:
```
/Users/[username]/Library/Mobile Documents/iCloud~md~obsidian/Documents/test/.obsidian
```

Override with environment variable:
```bash
export SOCIAL_ARCHIVER_TEST_VAULT="/path/to/your/vault/.obsidian"
npm run build:deploy
```

#### 4. Testing Backend Services

```bash
# Workers API (local)
cd workers
npm run dev:local

# Share Web (local)
cd share-web
npm run dev

# Run all services
npm run dev:all
```

#### 5. Staging Deployment

Test with production backend:
```bash
npm run deploy:staging

# Restore development environment
npm run restore:dev
```

</details>

### Project Structure

```
obsidian-social-archiver/
├── .github/
│   └── workflows/
│       └── release.yml          # GitHub Actions release workflow
├── src/                          # Plugin source code
│   ├── main.ts                  # Main plugin entry
│   ├── components/              # Svelte 5 components (10 files)
│   ├── services/                # Business logic (40+ services)
│   │   ├── base/               # Base service classes
│   │   ├── ArchiveOrchestrator.ts
│   │   ├── WorkersAPIClient.ts
│   │   ├── MarkdownConverter.ts
│   │   ├── VaultManager.ts
│   │   ├── MediaHandler.ts
│   │   ├── PendingJobsManager.ts
│   │   └── RealtimeClient.ts
│   ├── views/                   # TimelineView
│   ├── modals/                  # ArchiveModal
│   ├── settings/                # Settings UI
│   ├── schemas/                 # Zod validation (8 platforms)
│   ├── types/                   # TypeScript interfaces
│   ├── utils/                   # Helper functions
│   ├── stores/                  # Svelte stores
│   └── hooks/                   # Svelte 5 hooks
├── workers/                      # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts            # Hono app entry
│   │   ├── handlers/           # API route handlers
│   │   ├── middleware/         # Auth, rate limiting
│   │   ├── durable-objects/    # TimelineRoom WebSocket
│   │   └── utils/              # JWT, credits, validation
│   └── tests/                  # Worker tests
├── share-web/                   # SvelteKit share app
│   ├── src/
│   │   ├── routes/
│   │   └── lib/
│   └── tests/
├── __tests__/                   # Plugin tests (51 files)
├── scripts/                     # Build scripts
├── manifest.json                # Plugin manifest
├── versions.json                # Version compatibility
└── package.json
```

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch

# Coverage report
npm run test:coverage

# UI testing
npm run test:ui

# Workers tests
cd workers && npm test

# Specific test file
npm test ArchiveOrchestrator
```

### Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'feat: add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Commit Convention**: We use conventional commits (feat, fix, docs, chore, refactor, test, perf)

[View Contributing Guidelines](CONTRIBUTING.md)

---

## 📚 Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Authentication Flow](docs/AUTH_FLOW.md)
- [Cloudflare Setup](docs/CLOUDFLARE_EMAIL_SETUP.md)
- [Testing Guide](docs/TESTING_GUIDE.md)
- [Privacy Policy](PRIVACY.md)
- [API Reference](docs/API_REFERENCE.md)

---

## 🐛 Known Issues & Limitations

### TikTok DRM Protection
- **Issue**: CDN URLs may fail due to DRM
- **Workaround**: Falls back to original post URL for video embed

### BrightData Rate Limits
- **Issue**: Scraping API has rate limits
- **Solution**: Queue management + retry logic + circuit breaker

### Mobile Localhost
- **Issue**: Mobile can't access localhost:8787
- **Solution**: Always uses production API on mobile

[View All Issues](https://github.com/hyungyunlim/obsidian-social-archiver-releases/issues)

---

## 🗺️ Roadmap

### Version 1.1 (Next Release)
- [ ] Vault-wide user post discovery (#146)
- [ ] Batch archiving
- [ ] Export to PDF/EPUB
- [ ] Advanced search filters

### Version 2.0 (Future)
- [ ] AI-powered summaries (Pro)
- [ ] Fact-checking integration (Pro)
- [ ] Sentiment analysis (Pro)
- [ ] Custom domain for share links (Pro)
- [ ] Browser extension (Chrome, Firefox, Safari)

### Long-Term Vision
- [ ] Very Very Social (Standalone SNS Platform)
  - Independent project with synergy
  - "Save what matters" → "Share what you think"

[View Full Roadmap](https://github.com/hyungyunlim/obsidian-social-archiver-releases/projects)

---

## 🤝 Support

### Get Help

- 📖 [Documentation](https://github.com/hyungyunlim/obsidian-social-archiver-releases/wiki)
- 🐛 [Report Issues](https://github.com/hyungyunlim/obsidian-social-archiver-releases/issues)
- 💬 [Discord Community](https://discord.gg/obsidian-social-archiver)
- 📧 [Email Support](mailto:support@social-archive.org)

### Show Your Support

If you find Social Archiver useful:

- ⭐ Star this repository
- 🐦 Share on social media
- 💰 [Sponsor on GitHub](https://github.com/sponsors/hyungyunlim)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/hyungyunlim)

---

## 📊 Project Status

**Development Progress**: 72% Complete (78/109 tasks done)

- ✅ Core archiving functionality
- ✅ 8 platform integrations
- ✅ Timeline view with filtering
- ✅ Real-time WebSocket updates
- ✅ Magic link authentication
- ✅ Mobile support
- ✅ Media handling (3 modes)
- ✅ Inline post composer
- ✅ Embedded archives (quote posts)
- ⏳ AI features (planned)
- ⏳ Custom domains (planned)

[View Task Progress](https://github.com/hyungyunlim/obsidian-social-archiver-releases/projects/1)

---

## 📄 License

MIT © 2024 Hyungyun Lim

See [LICENSE](LICENSE) for details.

---

## ⚠️ Disclaimer

**Important**: Only archive content you have permission to save. Respect copyright and privacy laws in your jurisdiction. This tool is intended for **personal archiving only**.

Social Archiver does not:
- Bypass any platform's terms of service
- Store or redistribute archived content
- Provide access to private or protected posts
- Enable mass scraping or data harvesting

**Use responsibly and ethically.**

---

## 🙏 Acknowledgments

- [Obsidian](https://obsidian.md) - For the amazing knowledge management platform
- [BrightData](https://brightdata.com) - For reliable web scraping infrastructure
- [Cloudflare](https://cloudflare.com) - For Workers, Pages, and D1 database
- [Svelte](https://svelte.dev) - For the reactive UI framework
- [TaskMaster AI](https://github.com/taskmaster-ai) - For development workflow automation

---

<div align="center">

**[⬆ Back to Top](#social-archiver-for-obsidian)**

Made with ❤️ by [Hyungyun Lim](https://github.com/hyungyunlim)

</div>
