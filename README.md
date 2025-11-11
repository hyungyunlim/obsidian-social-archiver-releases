# Social Archiver for Obsidian

<div align="center">

![Social Archiver Logo](https://img.shields.io/badge/Obsidian-Social_Archiver-8B5CF6?style=for-the-badge&logo=obsidian)

**Save what matters.** Archive social media posts from 8 major platforms directly into your Obsidian vault.

[![GitHub release](https://img.shields.io/github/v/release/hyungyunlim/obsidian-social-archiver?style=flat-square)](https://github.com/hyungyunlim/obsidian-social-archiver/releases)
[![License](https://img.shields.io/github/license/hyungyunlim/obsidian-social-archiver?style=flat-square)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/hyungyunlim/obsidian-social-archiver/total?style=flat-square)](https://github.com/hyungyunlim/obsidian-social-archiver/releases)

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
- 🌐 **8 Platform Support**: Facebook, LinkedIn, Instagram, TikTok, X.com, Threads, YouTube, and Reddit
- 🚀 **Production-Ready**: Built with TypeScript strict mode, comprehensive test coverage, and SRP architecture

---

## ✨ Features

### Core Functionality

#### 🌐 Multi-Platform Support
Archive posts from 8 major social media platforms:

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

#### 📊 Obsidian Bases Integration

<details>
<summary>Use Bases for Advanced Views (click to expand)</summary>

Social Archiver is fully compatible with [Obsidian Bases](https://help.obsidian.md/bases) for database-like views:

- **Table View**: Sortable columns with platform, author, engagement metrics
- **Cards View**: Gallery-style browsing with visual previews
- **Calendar View**: Timeline visualization by archive date
- **Gallery View**: Media-focused masonry grid

**Quick Start:**
1. Right-click "Social Archives" folder → "Create base from folder"
2. Choose your preferred view (Table, Cards, Calendar, etc.)
3. Use frontmatter fields for filtering and sorting

**Example Filters:**
- `share = true` - Only shared posts
- `platform = "instagram"` - Platform-specific
- `likes > 100` - High engagement posts
- `archived > date("2024-01-01")` - Recent archives

📖 [Full Bases Integration Guide](docs/BASES_INTEGRATION.md)

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

1. Download the latest release from [GitHub Releases](https://github.com/hyungyunlim/obsidian-social-archiver/releases)
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

[View All Issues](https://github.com/hyungyunlim/obsidian-social-archiver/issues)

---

## 🗺️ Roadmap

### Version 1.1 (Next Release)
- [ ] Vault-wide user post discovery
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

---

## 🤝 Support

### Get Help

- 📖 [Documentation](https://github.com/hyungyunlim/obsidian-social-archiver/wiki)
- 🐛 [Report Issues](https://github.com/hyungyunlim/obsidian-social-archiver/issues)
- 📧 [Email Support](mailto:support@social-archive.org)

### Show Your Support

If you find Social Archiver useful:

- ⭐ Star this repository
- 🐦 Share on social media
- 💰 [Sponsor on GitHub](https://github.com/sponsors/hyungyunlim)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/hyungyunlim)

---

## 📊 Project Status

**Current Version**: 1.0.3 (Beta)

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

---

## 📄 License

MIT © 2024 Hyungyun Lim

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

---

<div align="center">

**[⬆ Back to Top](#social-archiver-for-obsidian)**

Made with ❤️ by [Hyungyun Lim](https://github.com/hyungyunlim)

</div>
