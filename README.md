# Social Archiver

Save what matters - Archive social media posts, web pages, newsletters, podcasts, and other supported sources to your private Social Archiver library, with clients for web, mobile, Chrome, and Obsidian.

[![release](https://img.shields.io/github/v/release/hyungyunlim/obsidian-social-archiver-releases)](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)
[![license](https://img.shields.io/github/license/hyungyunlim/obsidian-social-archiver-releases)](LICENSE)
[![downloads](https://img.shields.io/github/downloads/hyungyunlim/obsidian-social-archiver-releases/total)](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)
[![documentation](https://img.shields.io/badge/docs-social--archive.org-7c3aed)](https://docs.social-archive.org)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Add_to_Chrome-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/social-archiver/gifddgdekeffpnadpdcgjaehmlblomaf)
[![App Store](https://img.shields.io/badge/App_Store-Download-0D96F6?logo=apple&logoColor=white)](https://apps.apple.com/us/app/social-archiver/id6758323634)
[![Google Play](https://img.shields.io/badge/Google_Play-Get_it-34A853?logo=googleplay&logoColor=white)](https://play.google.com/store/apps/details?id=com.socialarchiver.mobile)

> **Currently in Free Beta** - Unlimited archiving, permanent web sharing, all features completely free during beta period. [Future pricing plans →](https://docs.social-archive.org/en/guide/pricing)

## Overview

Social media platforms are ephemeral. Posts disappear, accounts get deleted, platforms shut down. Social Archiver gives you a **permanent, searchable archive library** for social media and web content.

**Why Social Archiver?**
- 🏠 **Data Ownership**: Your archive library belongs to your account, with local copies in the clients you use
- 📱 **Cross-Platform**: Works across Obsidian, Chrome, web, iOS, and Android
- ⚡ **Real-Time Processing**: Background job processing with live progress updates
- 🔄 **Cross-Device Sync**: Keep archives and supported state changes aligned across clients
- 🎨 **Timeline View**: Browse and search all your archives in a beautiful feed
- 🌐 **Web Sharing**: Share archived posts to the web with public timelines
- 🔒 **Privacy-First**: You control what is stored locally, synced, or shared publicly

## Supported Platforms

Archive content from **21 major platforms**:

| Platform | Post Archive | Profile Crawl | Subscription | Notes |
|----------|:------------:|:-------------:|:------------:|-------|
| **Facebook** | Yes | Yes | Yes | Full metadata extraction |
| **Instagram** | Yes | Yes | Yes | Media optimization |
| **TikTok** | Yes | Yes | Yes | Transcript extraction, DRM fallback |
| **Pinterest** | Yes | Yes | Yes | Pins and profiles |
| **Reddit** | Yes | Yes | Yes | Subreddits only for crawl/subscription |
| **YouTube** | Yes | Yes | Yes | RSS-based, max 15 posts, free |
| **Bluesky** | Yes | Yes | Yes | Direct API, free |
| **Mastodon** | Yes | Yes | Yes | Direct API, all instances, free |
| **LinkedIn** | Yes | Yes | Yes | Professional network archiving |
| **X (Twitter)** | Yes | Yes | Yes | RSS-based via xcancel, free |
| **Threads** | Yes | No | No | Requires login for profile access |
| **Naver Blog** | Yes | Yes | Yes | Local crawl, video support, free |
| **Naver Cafe** | Yes | Yes | Yes | Local crawl, cookie required, free |
| **Brunch** | Yes | Yes | Yes | Local crawl, series support, free |
| **Naver Webtoon** | Yes | Yes | Yes | Series subscription, immersive reader, free |
| **Podcast** | No | No | Yes | RSS subscription only, custom audio player, free |
| **Substack** | Notes only | No | Yes | Notes support post archive; newsletters via RSS subscription only, free |
| **Medium** | No | No | Yes | Articles via RSS subscription only, free |
| **Tumblr** | Yes | No | Yes | Posts via RSS, free |
| **Velog** | No | No | Yes | Korean tech blog, RSS subscription only, free |
| **Generic Blog** | No | No | Yes | RSS subscription only, free |

YouTube, X (Twitter), Bluesky, Mastodon, Naver Blog, Naver Cafe, Brunch, Naver Webtoon, Podcasts, and all RSS-based platforms use free APIs/local crawling and don't consume archive credits.

**Tip:** Use [Listen Notes](https://listennotes.com) to find podcast RSS feeds. Each podcast page has an "RSS" button.

## Key Features

### 🗂 Archiving Process
- **Instant Archive Entry**: Archive appears quickly in your library; the Obsidian client can also write Markdown notes into your vault
- **Background Download**: Full content downloads in the background - you can keep working in any client
- **Live Progress Updates**: Real-time notifications as it downloads
- **Automatic Retry**: If something fails, it automatically tries again (up to 3 times)
- **Media Modes**: Choose what to save - text only, images only, or everything including videos
- **Link Previews**: Automatically extracts and embeds link preview cards from post content

### 📂 Profile Crawl
- **Bulk Archive**: Archive multiple posts from a profile in a single operation
- **Date Range Filtering**: Choose posts from specific time periods (24h to all time)
- **Post Count Control**: Select how many posts to archive (1-20)
- **Real-Time Progress**: Live status updates during crawl
- **Automatic Deduplication**: Previously archived posts are skipped

### 🔔 Subscriptions
- **Automatic Archiving**: Subscribe to profiles for daily automatic archiving
- **Smart Deduplication**: Post ID and content hash tracking prevents duplicates
- **Author Catalog**: Manage all subscriptions from a central interface
- **Timeline Integration**: Subscribed author badges shown on posts
- **RSS Support**: Subscribe to newsletters, blogs, and podcasts (Substack, Medium, Tumblr, Velog) - completely free!

### 🎙️ Podcast Support (Desktop Only)
- **RSS Feed Subscriptions**: Subscribe to any podcast via RSS feed URL
- **Custom Audio Player**: Play/pause, progress bar, and time display in Timeline View
- **Episode Metadata**: Duration, season/episode numbers, publish date, hosts & guests
- **Cover Art**: Podcast cover art and episode thumbnails
- **Web Sharing**: Audio player works on shared links (social-archive.org)
- **Whisper Transcription**: Generate searchable transcripts using Whisper (local processing)
  - Requires [Whisper installed locally](https://docs.social-archive.org/en/guide/transcription)
  - Click-to-jump: Click any transcript segment to jump to that timestamp
  - Full privacy: Audio processed entirely on your device

### 📱 Timeline View
- **Custom View**: Browse all your saved posts in one scrollable feed
- **Media Gallery**: Pinterest-style layout showing all images and videos from your archives
- **Filters**: Filter by platform, date range, and status
- **Full-Text Search**: Search across all archived content
- **Post Composer**: Write and publish your own posts with images and web sharing
- **Auto-Refresh**: Timeline updates automatically when archiving completes

### 🌐 Web Sharing
Share your archived posts to the web with your personal public timeline:
- **Preview Mode**: Copyright-safe with text excerpts and platform links (no media)
- **Full Mode**: Complete original content with media (use with caution)
- **Permanent URLs**: Each shared post gets its own URL
- **Public Timeline**: Access all your shared posts at `/{username}`
- **Real-Time Updates**: Timeline updates automatically as you share more posts

### 🔄 Cross-Device Sync
Use one Social Archiver account across the web app, mobile apps, Chrome extension, and Obsidian plugin:
- **Archive Library Sync**: Import existing server archives into your Obsidian vault with **Sync Existing Archives**
- **New Archive Sync**: Archives created from mobile, web, Chrome, or server jobs can appear in Obsidian and mobile
- **State Sync**: Inbox/archive state, stars/likes, share state, tags, highlights, and notes sync where supported
- **Delete Sync**: Optional bidirectional delete sync between the server and Obsidian vault
- **Offline-Friendly**: Mobile queues changes and syncs when connectivity returns

Obsidian must be open and connected when the plugin writes Markdown files into your vault. Social Archiver sync is separate from Obsidian Sync, iCloud Drive, Dropbox, and other vault sync tools.

### AI Comments (Desktop Only)
Add AI-powered analysis to your archived posts using local CLI tools:
- **Supported CLIs**: [Claude Code](https://claude.com/product/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex](https://github.com/openai/codex)
- **Analysis Types**:
  - **Summary**: Concise 2-3 sentence overview
  - **Fact Check**: Verify claims with web search (sources included)
  - **Critique**: Balanced critical analysis
  - **Sentiment**: Emotional tone analysis
  - **Glossary**: Explain technical/specialized terms with sources
  - **Connections**: Find related notes in your vault (Obsidian wikilinks)
  - **Reformat**: Improve markdown formatting without changing content (apply with one click)
  - **Custom**: Your own prompt template
- **Multi-Language**: Auto-detect content language or specify output language
- **Web Sharing**: AI comments appear on shared posts at social-archive.org
- **Privacy**: All AI processing happens locally on your device

**Requirements**: At least one AI CLI tool must be installed and authenticated on your computer.

### ⚙️ Configuration
- **Folder Paths**: Customize where archives and media are saved
- **File Naming**: Templates with tokens: `{date}`, `{platform}`, `{author}`, `{slug}`
- **YAML Frontmatter**: Rich metadata for filtering and search
- **Statistics**: Usage tracking and performance metrics

## Installation

### Chrome Extension

Install the Social Archiver Chrome extension:

- **Chrome Web Store**: [Social Archiver](https://chromewebstore.google.com/detail/social-archiver/gifddgdekeffpnadpdcgjaehmlblomaf)
- **Keyboard Shortcut**: `Ctrl+Shift+S` (`Cmd+Shift+S` on Mac) to archive the current page
- **Right-Click Menu**: Archive any page from the context menu
- **Web Clipping**: Select and save any web page content with the built-in editor
- **Instagram Import**: Import selected Instagram saved-post collections from your logged-in browser session
- **Same Account**: Use the same email/username across web, mobile, Chrome, and Obsidian

### Mobile App

Install the Social Archiver mobile app:

- **App Store (iOS)**: [Social Archiver](https://apps.apple.com/us/app/social-archiver/id6758323634)
- **Google Play (Android)**: [Social Archiver](https://play.google.com/store/apps/details?id=com.socialarchiver.mobile)
- **Share Extension**: Archive directly from social apps and mobile browsers
- **Offline Reading**: Browse, search, and read cached archives locally
- **Auto Sync**: Sync archives and supported state changes with your Social Archiver account
- **Same Account**: Use the same email as your desktop plugin, Chrome extension, and web app

### Web App

Use Social Archiver from the web:

- **Website**: [social-archive.org](https://social-archive.org)
- **Private Owner Views**: Browse All, Inbox, Archive, Starred, Shared, Notes, Tags, and Authors after signing in
- **Archive from Web**: Paste supported URLs and submit archive jobs directly from a browser
- **Organize**: Manage inbox/archive state, stars, tags, notes, highlights, deletes, and bulk actions
- **Public Timeline**: Share selected posts at `https://social-archive.org/{username}`

### Community Plugins (Coming Soon)

> **Note**: Social Archiver is currently under review for the Obsidian Community Plugin store. Once approved, you'll be able to install it directly through the plugin browser.

### Manual Installation

#### Option 1: BRAT Plugin (Recommended - Auto Updates)

Using [BRAT](https://github.com/TfTHacker/obsidian42-brat) allows you to receive automatic updates:

1. **Install BRAT** (if not already installed)
   - Open **Settings** → **Community Plugins** → **Browse**
   - Search for "BRAT"
   - Install and enable it

2. **Add Social Archiver via BRAT**
   - Open **Settings** → **BRAT**
   - Click **Add Beta Plugin**
   - Enter repository: `https://github.com/hyungyunlim/obsidian-social-archiver-releases`
   - Click **Add Plugin**

3. **Enable the plugin**
   - Go to **Settings** → **Community Plugins**
   - Find "Social Archiver" and enable it

BRAT will automatically check for and install updates from new releases.

#### Option 2: Manual Download

For one-time installation without auto-updates:

1. Download latest release from [Releases](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css`
3. Copy to `.obsidian/plugins/social-archiver/` in your vault
4. Reload Obsidian (`Cmd/Ctrl + R`)
5. Enable in **Settings** → **Community Plugins**

## Quick Start

### 1. Account Authentication

First-time setup requires email verification:

1. Click ribbon icon (bookmark-plus) or go to **Settings** → **Social Archiver**
2. Enter your **email** and choose a **username**
   - Email is used for authentication only (magic link sent here)
   - Username is your unique public identifier for web sharing
3. Check your email for the magic link (valid for 5 minutes)
4. Click the link → Click "Open in Obsidian" button
5. You're ready to archive!

**Why do I need an account?**
Social Archiver uses server infrastructure to fetch content through web scraping. Authentication helps prevent abuse from bots and automated scripts. We use passwordless magic links (no passwords to remember), and authentication state doesn't sync across devices.

### 2. Archive Your First Post

**Method 1: Archive Modal (Recommended)**
1. Copy a social media post URL
2. Click the ribbon icon (bookmark-plus) or use Command Palette → "Archive social media post"
3. Paste URL and click **Archive**
4. Note appears instantly - full content downloads in background

**Method 2: Post Composer in Timeline**
1. Open Timeline View (calendar-clock ribbon icon)
2. Click the Post Composer at the top
3. Write your content and paste social media URLs
4. Click **Post** → Archive suggestion banner appears
5. Click "Archive this post" to save the linked content

### 3. Browse Your Archives

- Open **Timeline View** to see all your saved posts
- Switch to **Media Gallery** for Pinterest-style image browsing
- Filter by platform badges or date range
- Search by content
- Create your own posts with the + button

### 4. Sync Across Clients

- In the mobile app, Auto Sync is enabled by default
- In Obsidian, open **Settings → Social Archiver → Sync** and click **Connect**
- Click **Sync Existing Archives** to bring your server archive library into the vault
- Enable Delete Sync if you want deletes to propagate between Obsidian and the server

## Example Output

Archived posts look like this:

```markdown
---
platform: facebook
author: John Doe
authorUrl: https://www.facebook.com/johndoe
published: "2024-11-14 10:30"
archived: "2024-11-14 15:22"
tags:
  - social/facebook
originalUrl: https://www.facebook.com/share/p/ABC123/
likes: 127
comments: 8
shares: 15
share: true
shareUrl: https://social-archive.org/username/abc123
---

Just finished reading an amazing book on productivity!
Here are my top 3 takeaways that completely changed how I work...

---

![image 1](attachments/social-archives/2024-11-14-facebook-1234567890/1.jpg)

---

**Platform:** Facebook | **Author:** [John Doe](https://www.facebook.com/johndoe)
**Published:** 2024-11-14 10:30 | **Likes:** 127 | **Comments:** 8 | **Shares:** 15

**Original URL:** https://www.facebook.com/share/p/ABC123/
```

## Documentation

- 📖 **Main Documentation**: https://docs.social-archive.org
- 🇬🇧 **English Guide**: https://docs.social-archive.org/en/guide/
- 🇰🇷 **Korean Guide**: https://docs.social-archive.org/ko/guide/
- 🔒 **Privacy Policy**: https://docs.social-archive.org/en/privacy
- 📜 **Terms of Service**: https://docs.social-archive.org/en/terms

## Privacy & Security

**What We Collect:**
- Email address (authentication only)
- Username (unique identifier)
- Archived content you explicitly archive, sync, or share
- Usage statistics (aggregated)

**What We DON'T Collect:**
- Social media passwords
- Browsing history
- Local vault contents beyond files you explicitly archive, sync, or share

**Security:**
- Magic link authentication (no passwords stored)
- HTTPS-only communication
- Token expiration (secure sessions)
- GDPR/PIPA/CCPA compliant

**[Read Full Privacy Policy →](https://docs.social-archive.org/en/privacy)**

## Current Status

**Free Beta**
- ✅ Completely free - no payment required
- ✅ Unlimited archiving during beta period
- ✅ Permanent web sharing (no expiration)
- ✅ All features available

**[Learn More About Pricing →](https://docs.social-archive.org/en/guide/pricing)**

## Known Limitations

- **Platform Changes**: Social media platforms may update their structure, temporarily affecting archiving

[View All Issues →](https://github.com/hyungyunlim/obsidian-social-archiver-releases/issues)

## Support

- 📧 **Email**: support@social-archive.org
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/hyungyunlim/obsidian-social-archiver-releases/issues)
- 📚 **Documentation**: [docs.social-archive.org](https://docs.social-archive.org)

## License

MIT © 2024-2025 Hyungyun Lim

## Disclaimer

⚠️ **Only archive content you have permission to save.** Respect copyright laws and platform terms of service.

Social Archiver is a tool for **personal archiving only**. It does not:
- Bypass platform terms of service
- Store or redistribute archived content on our servers
- Provide access to private posts
- Enable mass scraping or commercial use

Use responsibly and ethically. You are solely responsible for ensuring you have the legal right to archive content.

## Acknowledgments

Built with:
- [Obsidian](https://obsidian.md) - The knowledge base platform
- [Cloudflare](https://cloudflare.com) - Infrastructure and CDN
- [Svelte](https://svelte.dev) - UI framework
- [BrightData](https://brightdata.com) - Web scraping API

Special thanks to the Obsidian community for feedback and support.

---

**Website**: https://social-archive.org  
**Made with ❤️ by [Hyungyun Lim](https://github.com/hyungyunlim)**
