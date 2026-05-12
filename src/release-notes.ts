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
    playStoreUrl?: string;
  };
}

/**
 * Release notes keyed by version number.
 * Only add entries for versions with notable changes.
 * Minor patches (e.g., 2.3.1, 2.3.2) without entries are silently skipped.
 */
export const RELEASE_NOTES: Record<string, ReleaseNote> = {
  '3.5.0': {
    title: 'Beta Wrap-Up + In-App Notices',
    date: '2026-05-04',
    notes: `## Beta is wrapping up

Thanks for being part of the Social Archiver beta. The free beta period is **wrapping up in the next few days**, and the plan structure will look like this:

- Existing beta users will **automatically transition to the Free plan** — no action needed.
- The **Free plan includes 10 archives per month**. Earn more by completing in-app missions on the mobile app's Rewards screen.
- Subscriptions and the lifetime offer are available **only through the mobile app**, since Obsidian community plugin policy doesn't allow in-plugin payments. To upgrade or restore an existing purchase, sign in on the mobile app with the same email — it will recognize your account.
`,
    isImportant: true,
    qrCode: {
      // QR encodes the smart-landing URL `https://social-archive.org/get-mobile?from=plugin`.
      // The landing page sniffs the User-Agent and 302-redirects iOS scans
      // to the App Store, Android scans to the Play Store, and shows a
      // store-buttons fallback page on desktop. One QR works for both
      // platforms; no separate Play Store text link needed.
      svgBase64:
        'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNyAzNyIgc2hhcGUtcmVuZGVyaW5nPSJjcmlzcEVkZ2VzIj48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNMCAwaDM3djM3SDB6Ii8+PHBhdGggc3Ryb2tlPSIjMDAwMDAwIiBkPSJNMiAyLjVoN20yIDBoMW0xIDBoMW0yIDBoMW0xIDBoMW0xIDBoM20yIDBoMW0yIDBoN00yIDMuNWgxbTUgMGgxbTQgMGgybTIgMGgybTEgMGgxbTIgMGgybTMgMGgxbTUgMGgxTTIgNC41aDFtMSAwaDNtMSAwaDFtMSAwaDNtMSAwaDFtMSAwaDNtMiAwaDNtMiAwaDFtMSAwaDFtMSAwaDNtMSAwaDFNMiA1LjVoMW0xIDBoM20xIDBoMW0xIDBoMW0zIDBoMW0yIDBoMW0yIDBoMW0zIDBoMW0xIDBoMW0xIDBoMW0xIDBoM20xIDBoMU0yIDYuNWgxbTEgMGgzbTEgMGgxbTEgMGgxbTMgMGgxbTEgMGgzbTMgMGgxbTEgMGgybTIgMGgxbTEgMGgzbTEgMGgxTTIgNy41aDFtNSAwaDFtMSAwaDFtMSAwaDFtMSAwaDFtMSAwaDFtNCAwaDFtMSAwaDJtMSAwaDFtMSAwaDFtNSAwaDFNMiA4LjVoN20xIDBoMW0xIDBoMW0xIDBoMW0xIDBoMW0xIDBoMW0xIDBoMW0xIDBoMW0xIDBoMW0xIDBoMW0xIDBoN00xMCA5LjVoMW0xIDBoM20zIDBoMW0yIDBoM20yIDBoMU0yIDEwLjVoMW0xIDBoNW0zIDBoMm0xIDBoMW0zIDBoNG0zIDBoMW0xIDBoNU0zIDExLjVoMW0yIDBoMm0zIDBoMW0zIDBoMW0yIDBoNm0xIDBoMW0yIDBoMm0xIDBoMm0xIDBoMU0yIDEyLjVoNG0xIDBoM20yIDBoMW0xIDBoNm0yIDBoM20yIDBoMW0yIDBoMW0xIDBoMk0yIDEzLjVoNm0yIDBoMW0yIDBoM20yIDBoM20yIDBoMm0xIDBoMW0xIDBoMW0xIDBoNU0yIDE0LjVoMm00IDBoMm0xIDBoMW0xIDBoMm0xIDBoM20yIDBoMm0xIDBoMm0xIDBoMW0xIDBoM20xIDBoMk0yIDE1LjVoMW00IDBoMW0xIDBoMm0xIDBoMm0xIDBoMW0xIDBoMW0xIDBoMm00IDBoMW0xIDBoMm0zIDBoM00yIDE2LjVoMm0xIDBoMW0yIDBoMW0xIDBoM200IDBoM20yIDBoM20yIDBoMm0xIDBoMW0yIDBoMU0yIDE3LjVoMW04IDBoMm0xIDBoMm0xIDBoMW0yIDBoMW0yIDBoMm0yIDBoMm0xIDBoM00zIDE4LjVoM20yIDBoMW0xIDBoNm0xIDBoMW0xIDBoMW00IDBoNG0xIDBoMm0zIDBoMU00IDE5LjVoMW0xIDBoMW0yIDBoMW0zIDBoM20yIDBoMW0xIDBoNG0xIDBoMW0xIDBoM20xIDBoMm0xIDBoMU01IDIwLjVoNW0xIDBoMm0yIDBoMW0xIDBoMm0xIDBoMW0zIDBoMW00IDBoMm0xIDBoMk0yIDIxLjVoMm0xIDBoMW0xIDBoMW0xIDBoMW0xIDBoMW0yIDBoMW0zIDBoMW00IDBoNG0xIDBoNk0zIDIyLjVoMW00IDBoMm0xIDBoMW0xIDBoMW0xIDBoMm0zIDBoMm0yIDBoMW0yIDBoMW0yIDBoMm0xIDBoMk0yIDIzLjVoMm0yIDBoMW0yIDBoNG0yIDBoNW0yIDBoMm0xIDBoMm0xIDBoMm00IDBoMU0yIDI0LjVoMW0xIDBoMW0xIDBoNG0yIDBoMW0xIDBoMm0zIDBoMW0xIDBoMW0xIDBoMW03IDBoM00yIDI1LjVoMW0xIDBoMW0xIDBoMm0xIDBoMW0xIDBoNG0zIDBoMW0yIDBoNG0yIDBoMm0yIDBoM00yIDI2LjVoMW0xIDBoMW0yIDBoNG0xIDBoMW0xIDBoMW0xIDBoMW0yIDBoMW0xIDBoMW0yIDBoN00xMCAyNy41aDJtMSAwaDJtNCAwaDFtMSAwaDJtMSAwaDFtMSAwaDFtMyAwaDFtMSAwaDFtMSAwaDFNMiAyOC41aDdtMiAwaDFtMSAwaDFtMSAwaDVtMiAwaDJtMSAwaDJtMSAwaDFtMSAwaDFtMSAwaDJNMiAyOS41aDFtNSAwaDFtMSAwaDFtMSAwaDFtMSAwaDJtMiAwaDRtMSAwaDRtMyAwaDRNMiAzMC41aDFtMSAwaDNtMSAwaDFtMSAwaDFtMSAwaDNtMiAwaDJtNSAwaDFtMSAwaDZtMSAwaDJNMiAzMS41aDFtMSAwaDNtMSAwaDFtMSAwaDFtMSAwaDJtMyAwaDFtMiAwaDFtMiAwaDFtMSAwaDFtMSAwaDFtMiAwaDJtMSAwaDJNMiAzMi41aDFtMSAwaDNtMSAwaDFtMSAwaDFtMiAwaDFtMiAwaDVtNCAwaDFtMiAwaDJtMiAwaDFNMiAzMy41aDFtNSAwaDFtMyAwaDJtMSAwaDFtMSAwaDFtMiAwaDRtMyAwaDJtMSAwaDNNMiAzNC41aDdtMSAwaDJtMyAwaDFtMSAwaDFtMSAwaDFtMSAwaDFtMiAwaDZtMyAwaDEiLz48L3N2Zz4K',
      url: 'https://social-archive.org/get-mobile?from=plugin',
      label: 'Scan to get the mobile app',
    },
  },
  '3.0.0': {
    title: 'Full Cross-Device Sync',
    date: '2026-03-26',
    notes: `## Full Cross-Device Sync

Archives, deletes, and composed posts now sync in realtime across Obsidian, mobile, and web via WebSocket.

- **Mobile app v1.3.3 required** for realtime sync — please update to the latest version
- Previously plugin-only deleted archives may reappear once from the server; simply delete again and it will sync properly
- Older archives with expired CDN media links may sync without images or with broken media
- Delete sync can be toggled independently (outbound/inbound) in Settings > Sync

## Crosspost & Threads

- Post mode dropdown: Share Link, Crosspost to Threads, or both
- Thread breaks with \`--\` / \`---\` delimiters
`,
    isImportant: true,
  },
  '2.8.4': {
    title: 'Cross-Device Login + Android Support',
    date: '2026-03-08',
    notes: `## Cross-Device Login (QR Code)

- Log into the Obsidian plugin by scanning a QR code or entering a pairing code from the mobile app
- No more switching between email and browser — approve login directly on your phone
- Universal Link QR codes work seamlessly on both iOS and Android

## Auto Sync on Mobile Login

- When you log in via the mobile app, sync is automatically enabled — no extra setup needed

## Android App Support

- Google Play Store badge added alongside the App Store badge
- Android App Links configured for seamless deep linking

## Sign-Out Cleanup

- Centralized sign-out now properly cleans up sync client registration
`,
    isImportant: true,
  },
  '2.8.1': {
    title: 'Reader Mode Polish + TTS Highlight Accuracy',
    date: '2026-03-02',
    notes: `## Reader Mode Updates

- Expanded share-web Reader Mode flow:
  - Full-screen overlay UX improvements
  - URL hash/permalink behavior while browsing posts
  - Swipe navigation and better mobile interaction polish
  - AI comments and multi-image carousel support inside Reader Mode
- Improved share-link behavior from Reader Mode for faster sharing

## TTS Highlighting Reliability

- Fixed Editor TTS highlight misalignment in Markdown documents with mixed formatting
- Improved cleaned-text to raw-text offset mapping stability for long-form web articles
- Added safer fallback sentence matching so highlighting skips bad ranges instead of jumping to the wrong section
`,
    isImportant: true,
  },
  '2.8.0': {
    title: 'Reader + Editor TTS',
    date: '2026-03-01',
    notes: `## TTS Is Now a Core Workflow

This release makes text-to-speech a first-class reading mode across archived posts and regular Markdown documents.

## Reader Mode TTS (Dual Engine)

- New Reader Mode TTS playback for archived posts
- Dual-engine support:
  - Supertonic on-device TTS (desktop)
  - Azure cloud TTS as fallback when needed
- Better language-aware voice selection, including broader Latin-script detection plus Arabic, Hindi, and Thai coverage
- Improved autoplay, sentence prefetching, and skip reliability for smoother long-form reading
- Improved sentence highlighting and playback stability across mixed block layouts

## Editor TTS (New)

- Added command palette actions:
  - Read document aloud (TTS)
  - Read selection aloud (TTS)
  - Pause / Resume reading (TTS)
  - Stop reading (TTS)
- Added a status bar mini player with progress, sentence navigation, and speed controls
- Added CodeMirror 6 synchronized highlighting during playback
`,
    isImportant: true,
  },
  '2.7.0': {
    title: 'Web Archiving + Archive-Time Tags + Filename Templates',
    date: '2026-02-23',
    notes: `## General Web Archiving (Beta)

You can now archive general web pages and articles (blogs, docs, newsletters, etc.) directly into Social Archiver, including pages found via web search.

- New Web platform flow for one-off archiving
- Uses the same open-source extraction foundation that powers Obsidian Web Clipper
- Improved URL routing, extraction cleanup, and inline image rendering for web articles
- Added Web platform filter and timeline support

## Archive-Time Tags

- Choose tags in the archive modal before starting the archive
- Tags are preserved through async/pending job completion flows

## Custom Filename Templates

- Configure Obsidian filename format in Settings using tokens
- Improved filename sanitization, duplicate-name handling, and settings UX

## Support

- Added a Support section in Settings with a Buy Me a Coffee link
`,
    isImportant: true,
  },
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
      playStoreUrl: 'https://play.google.com/store/apps/details?id=com.socialarchiver.mobile',
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
