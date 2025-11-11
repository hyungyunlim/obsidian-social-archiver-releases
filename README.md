# Social Archiver for Obsidian

Archive social media posts from 8 major platforms directly into your Obsidian vault. Built with TypeScript, Svelte, and Cloudflare infrastructure.

[![GitHub release](https://img.shields.io/github/v/release/hyungyunlim/obsidian-social-archiver-releases?style=flat-square)](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)
[![License](https://img.shields.io/github/license/hyungyunlim/obsidian-social-archiver-releases?style=flat-square)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/hyungyunlim/obsidian-social-archiver-releases/total?style=flat-square)](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)

**Currently in Beta** - Free unlimited archiving during beta period.

## Overview

Social Archiver transforms social media posts into permanent, searchable Markdown files in your vault. Your data stays local with seamless syncing across desktop and mobile devices.

**Key Benefits:**
- Data ownership - archived content never leaves your vault
- Cross-platform - supports desktop and mobile with share extensions
- Real-time processing - WebSocket-powered background job processing
- Timeline view - browse and search archived posts
- Production-ready - TypeScript strict mode, comprehensive test coverage

## Supported Platforms

| Platform | Content Types | Features |
|----------|--------------|----------|
| Facebook | Posts, Photos, Videos | Full metadata extraction |
| LinkedIn | Posts, Articles | Professional network archiving |
| Instagram | Posts, Reels, Stories | Media optimization |
| TikTok | Videos | Transcript extraction |
| X (Twitter) | Tweets, Threads, Spaces | Thread unrolling |
| Threads | Posts | Meta platform integration |
| YouTube | Videos | Raw and formatted transcripts |
| Reddit | Posts, Comments | Nested comment preservation |

## Features

### Archiving
- Instant document creation with background processing
- Non-blocking async job processing with automatic retry
- Real-time WebSocket notifications
- Three media modes: text-only, images-only, or full media
- Automatic link preview extraction
- Quote post embedding with nested display

### Timeline View
- Custom Obsidian view (sidebar or full-screen)
- Filter by platform, date range, and status
- Full-text search across content
- Inline post composer
- Automatic refresh on completion

### Authentication
- Magic link passwordless authentication
- JWT token-based API access
- Multi-device support
- Protocol handler for mobile share extension (`obsidian://social-archive`)

### Configuration
- Customizable folder paths for archives and media
- File naming templates with tokens: `{date}`, `{platform}`, `{author}`, `{slug}`
- YAML frontmatter with rich metadata
- Usage statistics and performance metrics

### Obsidian Bases Integration
Compatible with Obsidian Bases for database-like views:
- Table view with sortable columns
- Cards view for gallery browsing
- Calendar view for timeline visualization
- Filter by frontmatter fields (`platform`, `likes`, `archived` date, etc.)

## Installation

### Community Plugins (Coming Soon)
1. Open Settings → Community Plugins → Browse
2. Search for "Social Archiver"
3. Click Install, then Enable

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from [latest release](https://github.com/hyungyunlim/obsidian-social-archiver-releases/releases)
2. Create folder: `<vault>/.obsidian/plugins/social-archiver/`
3. Extract files to that folder
4. Reload Obsidian and enable the plugin in Settings → Community Plugins

## Quick Start

### Account Setup
1. Open Archive Modal (Command Palette → "Social Archiver: Archive social media post")
2. Enter email and username (first-time only)
3. Verify email via magic link
4. Start archiving

### Archive a Post (Desktop)
**Command Palette:**
1. Copy post URL
2. Press `Cmd/Ctrl + P` → "Social Archiver: Archive social media post"
3. Paste URL and click Archive

**Clipboard Archive:**
1. Copy post URL
2. Press `Cmd/Ctrl + P` → "Social Archiver: Archive from clipboard URL"

**Timeline View:**
1. Open Timeline View
2. Click + button
3. Enter URL and archive

### Archive a Post (Mobile)
1. Open social media app
2. Find post → Tap Share
3. Select Obsidian → Social Archiver
4. Post saved automatically to vault

### Browse Timeline
1. Open Timeline View (sidebar on desktop, full-screen on mobile)
2. Filter by platform badges or date range
3. Search by content
4. Create user posts with + button

## Privacy & Security

**Data Collection:**
- Email address (authentication only)
- Username (unique identifier)
- Usage statistics (aggregated)
- Performance metrics

**Data NOT Collected:**
- Archived content (stays in your vault)
- Social media passwords
- Browsing history
- Vault contents

**Security Measures:**
- Magic link authentication (no passwords)
- IP-based rate limiting (20 requests/hour)
- HTTPS-only communication
- Token expiration (15 minutes)

**Compliance:**
- GDPR compliant
- Data minimization
- Right to deletion
- Transparent processing

## Known Limitations

**TikTok DRM:** Some videos may fail due to DRM protection. Falls back to original post URL.

**Rate Limits:** BrightData API has rate limits. Managed with queue system and retry logic.

**Mobile Localhost:** Mobile devices use production API only.

[View all issues](https://github.com/hyungyunlim/obsidian-social-archiver-releases/issues)

## Roadmap

**Version 1.1**
- Vault-wide user post discovery
- Batch archiving
- Export to PDF/EPUB
- Advanced search filters

**Version 2.0**
- Browser extension (Chrome, Firefox, Safari)
- Enhanced media processing
- Performance optimizations

## Support

- [Documentation](https://github.com/hyungyunlim/obsidian-social-archiver-releases/wiki)
- [Report Issues](https://github.com/hyungyunlim/obsidian-social-archiver-releases/issues)
- [Email Support](mailto:support@social-archive.org)

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit with conventional commits (feat, fix, docs, etc.)
4. Submit a Pull Request

## License

MIT © 2024 Hyungyun Lim

## Disclaimer

**Only archive content you have permission to save.** Respect copyright and privacy laws. This tool is for personal archiving only.

Social Archiver does not:
- Bypass platform terms of service
- Store or redistribute archived content
- Provide access to private posts
- Enable mass scraping

Use responsibly and ethically.

## Acknowledgments

Built with:
- [Obsidian](https://obsidian.md)
- [BrightData](https://brightdata.com)
- [Cloudflare](https://cloudflare.com)
- [Svelte](https://svelte.dev)

---

Made by [Hyungyun Lim](https://github.com/hyungyunlim)
