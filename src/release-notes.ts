/**
 * Release Notes Data
 *
 * Contains release notes for versions that warrant user notification.
 * Minor patches without entries are silently skipped.
 */

export interface ReleaseNote {
  title: string;
  date: string;
  notes: string;
  isImportant?: boolean;
  qrCode?: {
    svgBase64: string;
    url: string;
    label: string;
  };
}

/**
 * Release notes keyed by version number.
 * Only add entries for versions with notable changes.
 * Minor patches (e.g., 2.3.1, 2.3.2) without entries are silently skipped.
 */
export const RELEASE_NOTES: Record<string, ReleaseNote> = {
  '2.6.0': {
    title: 'Video Transcription & Batch Processing',
    date: '2026-02-15',
    notes: `## 🎙️ Video Transcription

Transcribe archived videos locally using **Whisper** (faster-whisper, whisper.cpp, or openai-whisper).

- A **transcription banner** appears on post cards with a local video — pick a model, see time estimates, and transcribe with one click.
- Transcripts are displayed as a **synced, scrollable panel** alongside the embedded video with playback controls.
- Toggle **closed captions (CC)** on local videos, synced to the transcript.
- **Translate transcripts** into other languages via the AI Comment menu (\`Translate Transcript\`), then switch between languages using pill-style tabs.

## 📦 Batch Download & Transcription

Process multiple videos at once from the command palette.

- Scans your archive folder and batch-downloads + transcribes all eligible videos (YouTube, TikTok, etc. via yt-dlp).
- Supports **pause, resume, and cancel** with progress persisted across plugin reloads.
- Improved batch notice UI with progress bar, icon buttons, and proper spacing.

## ⚡ Archive Loading UX

Replaced the old "preliminary document" pattern with a **progress banner** at the top of the timeline.

- Shows real-time status for each job (queued, archiving, completed, failed) without creating placeholder files.
- Dismiss or retry any job directly from the banner.
- Works seamlessly with multi-device flows.

## 🔧 Fixes

- Fixed Facebook Reels saved as thumbnails instead of actual video.
- Improved mobile sync resilience for transient server errors.
- Fixed \`Folder already exists\` race condition in VaultManager.
`,
    isImportant: true,
  },
  '2.5.6': {
    title: 'Archive Organization & Settings UX',
    date: '2026-02-13',
    notes: `## 🗂️ Archive Folder Organization

You can now choose how archived notes are organized in your vault:

- \`ArchiveFolder/Platform/Year/Month\` (default)
- \`ArchiveFolder/Platform\`
- \`ArchiveFolder\` only (flat)

This organization mode is now applied consistently across main archive flows and subscription saves.

## 🧩 Frontmatter Custom Properties UX

- Improved key selection flow for custom properties:
  - Select from existing vault keys
  - Choose **Custom key...** when you want to enter a new key
- Added a direct link to the full template variable guide in Settings.

## 🔧 Fixes

- Fixed settings credit display to prevent invalid values like \`NaN left\`.
- Unlimited beta accounts now consistently show **Unlimited** credit status.
- Improved subscription handling so quoted external link preview media is preserved more reliably.
`,
    isImportant: false,
  },
  '2.5.5': {
    title: 'Plugin Workflow Improvements',
    date: '2026-02-11',
    notes: `## ✨ Plugin Improvements

- Added **customizable frontmatter settings** for archive files
- Improved quoted-post handling in Obsidian sync to preserve referenced content more reliably
- Fixed metadata parsing so quoted-post media is no longer mixed into the main post media list
- Added automatic **@mention linkification** for X content in timeline and markdown output
`,
    isImportant: false,
  },
  '2.5.3': {
    title: 'Reader Mode & Font Settings',
    date: '2026-02-06',
    notes: `## 📖 Reader Mode

Distraction-free reading experience for archived posts.

- **Mobile**: Long-press (tap & hold) on post body to enter
- **Desktop**: Click the book icon at the bottom-right of a post card

### Keyboard Shortcuts (Desktop)

| Key | Action |
|---|---|
| \`←\` / \`→\` | Previous / Next post |
| \`A\` | Archive to vault and advance |
| \`T\` | Tag post |
| \`C\` | Add comment / note |
| \`Delete\` | Delete post |
| \`Esc\` | Close reader mode |

## 🔤 Obsidian Font Settings

The timeline now respects your font settings from **Settings > Appearance**.

- **Post body text** uses your configured Text Font
- **Metadata** (author, date, counts) uses the Interface Font

`,
    isImportant: false,
  },
  '2.5.2': {
    title: 'iOS App Released & Performance',
    date: '2026-02-05',
    notes: `## 📱 iOS App Now Available

The **Social Archiver iOS app** is here! Archive social media posts directly from your phone using the share extension — syncs automatically to your Obsidian vault.

## ⚡ Performance & Stability

- Timeline rendering architecture overhaul for smoother scrolling
- Fixed memory leaks across plugin lifecycle and caches
- iPad/iPhone action button improvements
`,
    isImportant: false,
    qrCode: {
      svgBase64: 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48IURPQ1RZUEUgc3ZnIFBVQkxJQyAiLS8vVzNDLy9EVEQgU1ZHIDEuMS8vRU4iICJodHRwOi8vd3d3LnczLm9yZy9HcmFwaGljcy9TVkcvMS4xL0RURC9zdmcxMS5kdGQiPjxzdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgNDEgNDEiIHNoYXBlLXJlbmRlcmluZz0iY3Jpc3BFZGdlcyI+PHBhdGggZmlsbD0iI2ZmZmZmZiIgZD0iTTAgMGg0MXY0MUgweiIvPjxwYXRoIHN0cm9rZT0iIzAwMDAwMCIgZD0iTTQgNC41aDdtMiAwaDFtMSAwaDFtMSAwaDFtNCAwaDRtMSAwaDFtMiAwaDdNNCA1LjVoMW01IDBoMW0zIDBoMW0yIDBoM20xIDBoMW0yIDBoMW0zIDBoMW0xIDBoMW01IDBoMU00IDYuNWgxbTEgMGgzbTEgMGgxbTEgMGgzbTEgMGgybTEgMGgxbTEgMGg1bTEgMGgxbTIgMGgxbTEgMGgzbTEgMGgxTTQgNy41aDFtMSAwaDNtMSAwaDFtMSAwaDFtMSAwaDFtMSAwaDFtMSAwaDdtMiAwaDFtMiAwaDFtMSAwaDNtMSAwaDFNNCA4LjVoMW0xIDBoM20xIDBoMW0xIDBoMW0xIDBoMW0yIDBoMW0xIDBoMW0xIDBoMW0zIDBoMW0xIDBoMW0yIDBoMW0xIDBoM20xIDBoMU00IDkuNWgxbTUgMGgxbTEgMGgybTEgMGg2bTQgMGgxbTQgMGgxbTUgMGgxTTQgMTAuNWg3bTEgMGgxbTEgMGgxbTEgMGgxbTEgMGgxbTEgMGgxbTEgMGgxbTEgMGgxbTEgMGgxbTEgMGgxbTEgMGg3TTEyIDExLjVoMW0xIDBoMW0xIDBoMW0xIDBoMm01IDBoMk00IDEyLjVoMW0xIDBoNW0yIDBoMm0xIDBoN20zIDBoMW0xIDBoMW0xIDBoNU00IDEzLjVoMW0yIDBoM20zIDBoMm0xIDBoMW0xIDBoMW0xIDBoMW0xIDBoM20xIDBoM20xIDBoMm0xIDBoMm0xIDBoMU00IDE0LjVoM20xIDBoMW0xIDBoMW0yIDBoMW0yIDBoMW0yIDBoMW00IDBoMW0xIDBoMW01IDBoMW0xIDBoMk01IDE1LjVoM20zIDBoMW0xIDBoMm0zIDBoMm0yIDBoMm0xIDBoNG0xIDBoMW0xIDBoNU03IDE2LjVoMW0yIDBoMW0zIDBoMm0zIDBoMW0yIDBoMW0xIDBoMW0xIDBoMW0xIDBoMm0yIDBoMk00IDE3LjVoM20xIDBoMW0yIDBoMm0zIDBoMW0xIDBoNW0xIDBoMm0xIDBoMW0yIDBoMW00IDBoMk01IDE4LjVoMm0xIDBoM20yIDBoM201IDBoMW0xIDBoM20yIDBoM20yIDBoM005IDE5LjVoMW0xIDBoMW0xIDBoNm0xIDBoMW0yIDBoMW0xIDBoMW0xIDBoMW0xIDBoM20xIDBoMk00IDIwLjVoMW0yIDBoMW0yIDBoM20xIDBoMm00IDBoMm00IDBoMW0yIDBoMW0xIDBoMm0zIDBoMU00IDIxLjVoMW0yIDBoMm0zIDBoM20zIDBoMW0xIDBoMm0xIDBoMm0xIDBoMm0yIDBoMm0xIDBoMm0xIDBoMU00IDIyLjVoMW00IDBoNW0yIDBoMm0xIDBoM20zIDBoMW0yIDBoMW0yIDBoMm0xIDBoMk00IDIzLjVoMW0xIDBoMW00IDBoM20xIDBoMW0xIDBoM20xIDBoNm0xIDBoOU01IDI0LjVoMW0zIDBoNG0xIDBoMW0yIDBoMW0xIDBoMm0yIDBoMW0yIDBoMW0yIDBoMW0xIDBoM20xIDBoMk00IDI1LjVoMW0yIDBoM200IDBoMW0xIDBoMm0xIDBoMW0yIDBoMm0xIDBoMW0xIDBoMW0yIDBoMW0zIDBoMW0xIDBoMU00IDI2LjVoMW01IDBoMm0xIDBoMW0yIDBoMW0yIDBoMm0yIDBoMW0xIDBoMW03IDBoM000IDI3LjVoMW0xIDBoMW00IDBoMW0zIDBoMm0yIDBoMW0zIDBoMW0xIDBoMW0yIDBoMm0yIDBoM000IDI4LjVoMW0zIDBoNG0xIDBoMm0xIDBoMm0xIDBoMW0xIDBoMW0xIDBoMW0yIDBoN00xMiAyOS41aDJtMSAwaDFtNCAwaDFtMiAwaDFtMSAwaDFtMSAwaDJtMyAwaDFtMSAwaDFtMSAwaDFNNCAzMC41aDdtNSAwaDJtMSAwaDJtMSAwaDFtMSAwaDVtMSAwaDFtMSAwaDFtMSAwaDJNNCAzMS41aDFtNSAwaDFtMSAwaDFtMSAwaDFtMSAwaDJtMiAwaDFtMyAwaDJtMSAwaDJtMyAwaDVNNCAzMi41aDFtMSAwaDNtMSAwaDFtMSAwaDJtMyAwaDJtMyAwaDFtMiAwaDFtMiAwaDZNNCAzMy41aDFtMSAwaDNtMSAwaDFtMSAwaDFtMSAwaDJtMSAwaDRtMiAwaDFtMiAwaDFtMSAwaDJtMiAwaDJtMSAwaDJNNCAzNC41aDFtMSAwaDNtMSAwaDFtMSAwaDJtMSAwaDFtNSAwaDJtMiAwaDJtMSAwaDRtMiAwaDFNNCAzNS41aDFtNSAwaDFtNCAwaDNtMiAwaDFtNCAwaDFtNCAwaDFtMSAwaDFtMSAwaDFNNCAzNi41aDdtMSAwaDNtMiAwaDFtMyAwaDJtMyAwaDNtMiAwaDFtMyAwaDEiLz48L3N2Zz4K',
      url: 'https://apps.apple.com/us/app/social-archiver/id6758323634',
      label: 'Download on the App Store',
    },
  },
  '2.5.0': {
    title: 'Tags, Bug Fixes & Mobile App',
    date: '2026-02-03',
    notes: `## 🏷️ Tag System

Organize your archived posts with **custom tags**.

- Create and manage tags from the post card action bar
- Filter archives by tag in the timeline
- Keyboard navigation support in Tag Modal
- Tag chips displayed on post cards for quick reference

## 🐛 Bug Fixes

- **Subscription quoted/shared posts**: Fixed an issue where media from quoted or shared posts in subscriptions was not being downloaded
- **Folder paths with spaces**: Fixed image links breaking when archive or media folders contain spaces (e.g., \`99 System/Attachments\`)
- **Media carousel**: Improved video playback stability and smooth slide transitions
- **CDN media expiry**: Subscription media is now pre-cached to R2 to prevent expired CDN links

## 📱 iOS Mobile App

The **Social Archiver iOS app** is coming soon! Archive posts directly from your phone using the share extension — no desktop required.

Stay tuned for the official launch announcement.
`,
    isImportant: true,
  },
};
