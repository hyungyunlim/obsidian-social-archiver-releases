# Social Archiver 2.2.0 Release Notes

**Release Date:** December 11, 2025

---

## What's New in 2.2.0

This release brings **RSS platform support** to Social Archiver, making it easier than ever to archive content from your favorite newsletters and blogs!

### New RSS Platform Subscriptions

You can now subscribe to and automatically archive content from:

| Platform | Description |
|----------|-------------|
| **Substack** | Subscribe to your favorite newsletters |
| **Medium** | Archive articles from Medium publications and authors |
| **Tumblr** | Archive posts from Tumblr blogs |
| **Velog** | Archive posts from Velog (Korean tech blog platform) |

**How it works:**
1. Open **Archive Modal** and paste a blog post URL
2. Click **Subscribe Only** or archive with subscription
3. New posts are automatically archived daily!

RSS subscriptions are **completely free** - they don't consume any archive credits.

### Inline Image Rendering

Blog posts now render images **inline with content**, just like they appear on the original site. No more separate media galleries for article images - everything flows naturally in your notes.

### Consecutive Image Gallery

When a blog post contains multiple consecutive images, they're now displayed in a beautiful **gallery layout** instead of a long vertical list.

### Code Block Copy Button

Technical blog posts now show a **copy button** on code blocks, making it easy to copy code snippets to your clipboard.

---

## Improvements

- **Platform Constants Centralization**: Internal code quality improvements for better maintainability
- **File Naming**: Fixed encoding issues with special characters in RSS post titles
- **R2 Storage**: Fixed deletion handling for shared posts
- **Title Display**: Improved badge and title rendering in Timeline view

---

## Installation

### Update via BRAT (Recommended)
If you installed via BRAT, updates are automatic! Just reload Obsidian.

### Manual Update
1. Download `main.js`, `manifest.json`, and `styles.css` from this release
2. Replace the files in `.obsidian/plugins/social-archiver/`
3. Reload Obsidian (`Cmd/Ctrl + R`)

---

## Quick Start: RSS Subscriptions

1. Copy a Substack, Medium, Tumblr, or Velog post URL
2. Open Archive Modal (ribbon icon or Command Palette)
3. Paste the URL - the platform will be auto-detected
4. Click **Subscribe Only** to start automatic archiving

---

## Full Changelog

### Added
- RSS platform subscription support (Substack, Tumblr, Medium, Velog)
- Inline image rendering for RSS/blog platforms
- Consecutive image gallery display
- Code block copy button styling
- Platform constants centralization across codebase

### Fixed
- RSS filename encoding issues with special characters
- R2 storage deletion handling
- Title and badge display in Timeline view
- Various platform detection improvements

---

## Supported Platforms (16 Total)

| Platform | Post | Profile Crawl | Subscription | Notes |
|----------|:----:|:-------------:|:------------:|-------|
| Facebook | Yes | Yes | Yes | Full metadata |
| Instagram | Yes | Yes | Yes | Media optimization |
| TikTok | Yes | Yes | Yes | Transcript extraction |
| Pinterest | Yes | Yes | Yes | Pins and profiles |
| Reddit | Yes | Yes | Yes | Subreddits only |
| YouTube | Yes | Yes | Yes | RSS-based, free |
| Bluesky | Yes | Yes | Yes | Direct API, free |
| Mastodon | Yes | Yes | Yes | Direct API, free |
| LinkedIn | Yes | Yes | Yes | Professional network |
| X (Twitter) | Yes | No | No | Post archive only |
| Threads | Yes | No | No | Post archive only |
| **Substack** | Yes | No | **Yes** | RSS subscription |
| **Medium** | Yes | No | **Yes** | RSS subscription |
| **Tumblr** | Yes | No | **Yes** | RSS subscription |
| **Velog** | Yes | No | **Yes** | RSS subscription |
| Generic Blog | Yes | No | Yes | Any RSS feed |

---

## Questions or Issues?

- **Documentation**: [docs.social-archive.org](https://docs.social-archive.org)
- **Bug Reports**: [GitHub Issues](https://github.com/hyungyunlim/obsidian-social-archiver-releases/issues)
- **Email**: support@social-archive.org

---

Thank you for using Social Archiver! Save what matters.
