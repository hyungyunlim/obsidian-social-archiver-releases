/**
 * Release Notes Data
 *
 * Source of the GitHub release body: the release workflow in
 * obsidian-social-archiver-releases (scripts/extract-release-notes.mjs) reads
 * this file as text. The in-app "What's new" modal no longer uses it — it
 * shows the release hub entries (src/plugin/release-notes/releaseNoteUpdates.ts).
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
  '4.9.1': {
    title: 'Posts you write reach your other apps',
    date: '2026-10-07',
    notes: `## Posts you write in Obsidian sync

- **They reach your other apps now.** Posts written in the timeline's **What's on your mind?** box were refused by the server, so they never showed up in the mobile and desktop apps or on the web. They sync now, including the ones that have waited in the queue since 4.9.0.
- **The post, not the note.** What syncs is the post's text and images, without the note's author line or image list. Editing a post updates its text and images in the note and everywhere else, and an edit uploads only the images it adds, so an image you removed stops showing on your other devices.
- **Sync keeps going.** Posts written offline go out when you're back online, a post follows its note through a rename or move, and links in a post stay links instead of turning into \`[[wikilinks]]\`.
- **Shared right after writing.** A post you share before it has synced now links to its synced copy, so later edits reach the public page.

## Fixes

- Adding more than one archived post to a post you wrote no longer repeats its **Referenced Social Media Posts** section, and notes that already have the repeated section read correctly again.

## Collaborative collections

- The collection view shows when each post was added, and members' **Collection notes** under each post, read-only. Collection notes and highlights are written in the mobile app (2.4.4) and the desktop app (0.8.5).

> [!NOTE]
> The server side is already live.
`,
  },
  '4.9.0': {
    title: 'Archive straight into collections',
    date: '2026-10-05',
    notes: `## Pick collections while you archive

- **Add to collection, in the archive window.** Under the tags, **Add to collection** lists the collections you can add to, most recently used first; you can also type a new name to create one. The post goes into them as soon as it's archived, so there's nothing to do afterwards. Nothing is picked by default.
- **New collections and queued archives.** A collection you just created on this device is synced before the archive is sent, and the choice stays with the archive while it waits in the queue or is retried.
- Not offered for links the plugin archives on this device (Naver Cafe with your cookie, Naver Blog, Brunch and Naver Webtoon), because those never reach the server.

## From the command line

- **\`social-archiver:archive collection=<id|name>\`** adds the archived post to one or more collections (comma-separated, up to 50) in queue mode. A collection that hasn't synced yet, or one where you're only a viewer, is refused before anything is sent.

> [!NOTE]
> The same option is in the mobile app (2.4.1, including the share sheet), the desktop app (0.8.2), the browser extension (1.11.0) and the \`social-archiver\` CLI (0.1.20, \`archive --collection\`). The server side is already live.
`,
  },
  '4.8.1': {
    title: 'Collections from the Obsidian CLI, shares that stay on your profile, and tag sync fixes',
    date: '2026-10-04',
    notes: `## Collections from the command line

- **\`social-archiver:collections\` in the Obsidian CLI.** Scripts and coding agents can list your collections, see which notes are in one, create one, add or remove notes (by path, the active note, or archive ids), print or create a collection’s share link, and open it in the timeline. Everything except sharing answers right away from this device, offline too. Sharing a private collection needs \`confirm=true\`; read the link a few seconds later with \`action=link\`.

## Shared posts stay on your profile

- **No more 30-day expiry.** Sharing a post from the plugin used to set one. A post with photos lost it right away, but a text-only share dropped off your profile after 30 days, even though its link kept working. New shares no longer expire, as in the apps.

## Tag sync fixes

- **Renaming a tag keeps it on your archives** instead of removing it from the server copy, and a slow rename no longer creates a second tag.
- **Tag edits made offline stick.** The next startup no longer undoes them.
- **Tags with spaces** from your other devices can be added to a note, and a note whose \`archiveTags\` holds a single value instead of a list is read correctly.
- **Startup no longer re-sends every note’s tags**, which could bring back a tag you removed on another device.

> [!NOTE]
> The server side is already live and needs no update: shares made from older plugin versions no longer get an expiry, and the few text-only shares that had dropped off profiles are listed again.
`,
  },
  '4.8.0': {
    title: 'Collections come to Obsidian, and AI chat archives read like articles',
    date: '2026-10-04',
    notes: `## Collections, now in Obsidian

- **Open a collection from the timeline.** The **Collections** button in the timeline header lists your collections, collaborative ones included. Choose one to see only its posts: the bar above them shows who can see it and how many posts it holds, copies its link and opens its other actions. Search, platform, tag and date filters still narrow it, while the tabs and quick filters step aside, as in the desktop app.
- **Add posts from wherever you are.** **Add to collection** is on every card (in the **More** menu on a phone), in the selection bar for several posts at once, in an archive note’s file menu and in the command palette. Type a new name to create a collection on the spot. Cards show which collections a post is in; click one to open it.
- **Share a collection.** **Copy link** makes a private collection viewable by anyone with the link and copies it. **Share settings** picks who can see it, what viewers see first and whether your notes and highlights appear, and can reset the link or stop sharing. A shared collection shows its posts in full, photos and videos included, so the plugin asks before the first share: your Preview share mode applies only to single posts.
- **Collect together.** **Members** creates invite links with a role and an expiry, changes roles and removes members, or lets you leave. In a collaborative collection, posts other members added appear below yours as read-only cards (this needs an internet connection), and **Show my notes and highlights** decides whether the others see yours.
- **Activity, in Obsidian too.** When someone adds posts to, joins or shares a collaborative collection you’re in, and neither your phone nor the desktop app gets it, a notice appears here; click it to open the collection. **Collaborative collection activity** in Settings › Collections turns these off for your account.
- **Collections in Bases.** **Write collections to note properties** in Settings › Collections adds an \`archiveCollections\` list to your archive notes for Bases, Dataview and search. It’s off by default because it writes to your notes, and editing the property doesn’t change a collection. **Create base from collection** makes a \`.base\` file that lists one collection’s notes.
- Which posts are in which collection is kept on this device and synced with your account, not written into your notes, so vault sync never conflicts over it. A note can join a collection once it’s uploaded to your account.

## Sharing a single post

- **A shared post’s share button opens a menu** with **Copy share link**, **Share settings…** and **Stop sharing**, instead of unsharing at once. **Share settings** chooses Public or Anyone with the link, whether the link opens the post or the reader, and whether your notes and highlights appear.
- New shares start the way they do in the apps: Public, opening as the post (or in the reader when **Copy reader mode link by default** is on), with your notes and highlights.

## AI chat archives read like articles

- **ChatGPT, Claude, Gemini, Perplexity, Grok and AdventAI archives** keep their headings, numbered lists and inline images. The note no longer escapes them (\`\\#\\#\`, \`1\\.\`) or repeats the images in a media section, and the timeline card shows the conversation as an article instead of a 300-character excerpt without its images. Notes saved before this update stay as they are.

## Fixes

- **Embedded archives stay as written.** Adding an archive to one of your own posts rewrote the archives already embedded in it, a little worse on every save: dates reset to the time of the save, names like Google Maps or Naver Webtoon were cut short, YouTube descriptions wrapped themselves again and Reddit posts lost their community. Each save now writes them back unchanged.
- **Links opened in in-app browsers.** A link opened from the Threads, Facebook or Instagram app, such as a Naver blog post, is recognized as the site it points to rather than as a Threads, Facebook or Instagram post. A pasted link with spaces around it is still recognized.
- **No upgrade prompt on the two-at-once limit.** With two archives already running, the message now reads “Too many archives in progress. Try again when one finishes.” The limit is the same on every plan, so it no longer suggests upgrading.

> [!NOTE]
> Collections belong to your Social Archiver account. The ones you made in the mobile (2.4.0 or later) or desktop (0.8.0 or later) app appear here once you’re signed in, and changes made here show up there.
`,
  },
  '4.7.11': {
    title: 'See what’s new after every update, and text in angle brackets stays in your notes',
    date: '2026-09-28',
    notes: `## See what’s new after every update

- **A “What’s new” window after each update.** The first time the plugin loads after an update, it shows what changed in that version, straight from the release notes and in your language. A new install doesn’t show it, and it opens only once the workspace is ready, so it never holds up startup.
- **Every release you skipped, in one place.** On desktop and tablets, skipped releases are listed beside the text, newest first. ↑ and ↓ move through the list, and ← and → step to an older or newer release. On a phone, Previous and Next page through them.

## Text in angle brackets stays in your notes

- **\`<inputs>\` no longer vanishes.** A line like \`<inputs>\` or \`<book title>\`, common in shared AI prompts, opened an HTML block, so the note’s reading view hid it and ran the lines inside it together. The note now keeps it as text in the post, its comments, a quoted post and embedded archives. Comments used to drop anything in angle brackets altogether.
- **The timeline agrees.** Thread captures from the Chrome extension no longer show a literal \`&lt;\` in the timeline, and embedded archive previews show \`1.\` and \`#\` without the backslash the note keeps.

## Fixes

- **Feed addresses point to subscriptions.** Archiving an RSS or Atom feed’s address now stops at once with a hint to subscribe to the feed, instead of retrying three times.

> [!NOTE]
> Part of this is on the server and already reaches you without this update: X posts saved through your X session in the mobile or desktop app are stored as posts again rather than long-form articles, an X post with a numbered list archived on another device keeps its \`<tag>\` text when it syncs to this vault, and a web page with nothing to read is no longer saved as an empty note or charged a credit.
`,
  },
  '4.7.10': {
    title: 'Review cards look like your timeline, and Facebook notes stay with their own post',
    date: '2026-09-27',
    notes: `## Today’s review shows your posts the way the timeline does

- **Timeline cards in the review.** For a post whose note is in this vault, the review card now shows the author, caption, photos and counts the way the timeline does. "Open in reader" opens the timeline’s reader and steps through the rest of today’s posts, and tapping a post in the finished list opens it there too.
- **Each card asks before it tells.** A recall question shows the author and photos with the caption covered until you choose "Show the answer", which uncovers it and adds the gist. A post with photos but no question asks "What was this post about?" over its photos, and a highlight is quoted above the post it came from.
- Posts without a note in this vault keep the server’s text and "Open original".

## Fixes

- **Facebook notes stay with their own post.** Some Facebook posts archived from share links were stored under the same bare link (facebook.com/story.php or photo.php). The plugin matched notes by that link, so one note could end up tied to another post’s archive, showing that post’s comments and review card, while the other posts never got a note. The plugin no longer treats a link like that as a post’s identity.
- **AI comments you request from this vault appear as soon as they finish.** When one runs elsewhere (Apple Intelligence through this vault’s CLI, the desktop app, Cloud AI), the timeline card updates once the comment is in the note, even with the reader or fullscreen view open.

> [!NOTE]
> The server now keeps each Facebook post’s real link, and the affected archives were repaired on September 27, so their original links open again in every app. Your vault re-links the note and adds the missing posts on its next sync. To finish at once, choose "Re-sync Archives" in Settings › Mobile sync › Archive Library Sync.
`,
  },
  '4.7.9': {
    title: 'Today’s review comes to Obsidian, and missed AI jobs get picked up',
    date: '2026-09-27',
    notes: `## Today’s review, right in Obsidian

- **Your daily review without the apps.** A "Today’s review" side panel shows the posts and highlights chosen for you each day, one card at a time. A recall question keeps its answer hidden until you ask, "Open note" jumps to the archive in your vault (or the original post when the note isn’t there), and finishing counts toward the same streak the mobile and desktop apps show.
- **Always a click away.** The status bar shows how many cards are left, and the ribbon icon, the "Open today’s review" command and \`obsidian://social-archive?op=review\` links all open it — including the "Open in Obsidian" button on the web review page the daily email links to.
- **Settings › Review** switches the daily review and the email digest on or off for your account, and hides the status-bar count on this device.

## AI comments and actions no longer get stuck

- **Missed jobs are picked up.** When the plugin runs AI jobs itself and misses the realtime notice for one — a sleeping laptop, a dropped connection — it now finds the job within a few minutes. Since 4.7.1 such a job could wait until another device took it over.
- **Finished comments reach the note right away.** A comment produced by another device or by the social-archiver CLI updates the note as soon as it is done, instead of waiting for the next catch-up while the banner sat at "Uploading result… 90%".
- **Apple Intelligence in the AI banner.** When this vault’s social-archiver CLI reports Apple Intelligence ready, the banner on a card offers it next to the other AI tools. Types the on-device model can’t run (fact check, critique, sentiment, connections, transcript translation) are greyed out.
- **CLI trouble shows up.** If the CLI executor keeps failing to reach the server, Settings → AI comment now shows a warning with the error; before, it only said "running".

## Archiving

- **Permanent failures stop retrying.** When the server reports that a post can’t be archived — private content, a closed group, a login-only Instagram Story — the plugin fails once and shows the server’s full explanation, instead of retrying three times and cutting the reason short.
- **RSS "Fetch & Subscribe" subscribes.** For Substack, Medium, velog, Tumblr, podcasts and other feeds, the button now also creates the daily subscription; before, it only fetched.
- **Post counts match the server’s limit.** Server-fetched feeds and Naver/Brunch subscriptions take up to 20 posts per run; the inputs used to allow up to 50 and then failed. One-time Naver and Brunch fetches still go up to 100.
- **Naver Map app share links** (naver.me) are recognized as place links.

> [!NOTE]
> Jobs handed to the social-archiver CLI are claimed within seconds with CLI 0.1.16 or newer (older versions could take up to two minutes). Update with \`brew upgrade social-archiver-cli\`, npm, or the installer in the CLI guide: https://docs.social-archive.org/en/guide/cli
`,
  },
  '4.7.8': {
    title: 'Local AI runs through the Social Archiver CLI, with Apple Intelligence on the Mac',
    date: '2026-09-20',
    notes: `## Local AI now runs through the Social Archiver CLI

- **One executor for every app.** When the \`social-archiver\` command-line tool (0.1.15 or newer) is installed, the plugin hands local AI comments and AI actions to it instead of running its own copy of the executor. Every provider the CLI has is available here — Claude Code, Gemini CLI, Codex, and on a Mac with macOS 26 on Apple silicon, **Apple Intelligence** — and later provider fixes reach you without a plugin update.
- **Nothing to set up.** The plugin finds the CLI on its own (Homebrew, \`~/.local/bin\`, npm, or the copy bundled with the desktop app) and uses the newest install it finds. Settings → AI comment shows which executor is active, the CLI version and the providers it sees, with a toggle to stay on the built-in executor and a field to point at a specific binary.
- **Safe fallback.** Without the CLI, or when it is too old, signed out or stops, the built-in executor keeps working exactly as before.

> [!NOTE]
> Install the CLI with \`brew install hyungyunlim/tap/social-archiver-cli\`, from npm, or with the installer in the CLI guide: https://docs.social-archive.org/en/guide/cli. Apple Intelligence needs macOS 26 on Apple silicon with Apple Intelligence switched on; fact check and transcript translation still use the cloud providers.
`,
  },
  '4.7.7': {
    title: 'AI chat links get their own platform, and AI comments say who wrote them',
    date: '2026-09-15',
    notes: `## ChatGPT, Claude, Gemini, Perplexity and Grok links are their own platform

- Shared conversations from those services (and AdventAI) are now archived as their own platform instead of a generic web link: each gets its own icon in notes and in the timeline, and its own filter. Existing archives keep working; new ones pick up the icon.

## AI comments show the tool that actually wrote them

- A comment generated on your desktop app could arrive here labelled as another provider, because the note header only carried an id the plugin did not recognise. Comments now name the tool that ran them — including **Apple Intelligence**, the on-device model the desktop app can use from macOS 26 on Apple silicon, which shows with a 🍎 and an "On-device" badge.
- Comments produced through the desktop app's action flow were shown as "Cloud AI" even when they ran locally on your own machine. They now show the real provider.

> [!NOTE]
> Running Apple Intelligence itself needs the desktop app 0.6.16 or newer; the plugin displays and syncs those comments but does not run them.
`,
  },
  '4.7.6': {
    title: 'Local AI with ChatGPT works again',
    date: '2026-09-14',
    notes: `## Summaries through ChatGPT (Codex) work again

- Since about September 8, OpenAI stopped offering the \`gpt-5.4-mini\` model to Codex when it is signed in with a ChatGPT account, and every summary or other AI action sent to Codex failed with a bare "AI action failed." even though Codex showed as logged in. The server now asks Codex for \`gpt-5.5\`, the model ChatGPT accounts still get, so requests from the mobile app and shared pages succeed again with no change on your side.
- When Codex does refuse a request, the plugin now keeps the reason Codex gives (it arrives in Codex's JSON output, not on stderr, which is why it was lost) instead of reporting a generic failure.

## Sync settings show their error text again

- The error banner in Mobile sync settings painted its text in the same red as its background, so a failed connection looked like an empty red bar. The message is readable again.
`,
  },
  '4.7.5': {
    title: 'AI actions say why they cannot run',
    date: '2026-09-10',
    notes: `## An AI action that cannot run now says so first

- Asking for a summary on a post with no text used to fail only after you tapped it, with a message that did not explain anything. The check now looks at the post itself, so an action that cannot run is greyed out up front and tells you the text is missing.
- The reason wording changed too: a post with no description, captions or transcript has nothing to analyze, and the notice says that instead of implying some text is there and more is needed.
`,
  },
  '4.7.4': {
    title: 'Subscriptions stop duplicating notes',
    date: '2026-09-08',
    notes: `## Subscription posts no longer land twice

- A subscription sync that started while Obsidian was still indexing the vault could not see the notes you already had, so every pending post was written again — usually into a different folder than the first copy, which is why the same post showed up twice in the timeline. Sync now waits for the file index, the same guard the rest of the plugin already uses.
- Leftover pairs from earlier runs are safe to delete: with two notes pointing at one archive, removing either one is local clean-up and never touches the copy on the server.

## Pinterest share links archive as pins

- Links from Pinterest's share sheet (\`pin.it\` and \`api.pinterest.com\`) were read as a board and archived as the wrong thing. They now resolve to the pin you shared.

## Product cards for more Korean shops

- Product pages on Godomall / NHN Commerce malls publish their price only in the checkout pixel, so they were saved as a plain web clip. The price is now read from there and the page becomes a product card.`,
  },
  '4.7.3': {
    title: 'Videos download again, quieter sync',
    date: '2026-09-02',
    notes: `## Videos archived from the plugin download again

- Since mid-June, archiving a post with a video from the plugin ended in "Video download failed" even though the server had kept a copy — the media proxy answered in a form the plugin rejected. Fixed on both sides. For notes that already carry the failure, archive the same URL again: the plugin now pulls the stored copy.

## Old notes stop resurfacing as "edited"

- Notes whose media exists only on the original device were rewritten on every sync pass (and showed \`media_expired\`). They are now left alone.
- The "Media updated — review needed" callout no longer lands on every note archived from the plugin. It appears only when the note actually has a missing local media reference to review.
- A server-side author avatar refresh no longer marks every archive by that author as updated, so the vault stops re-walking thousands of notes after a subscription run.

## Fewer duplicate notes, safer clean-up

- Sync now waits for Obsidian's file index before matching server archives to existing notes, closing a source of duplicate notes on a cold start.
- Deleting one copy of a duplicate pair is now just local clean-up: it no longer deletes the archive on the server or blocks the surviving note from future updates.`,
  },
  '4.7.2': {
    title: 'See which AI model wrote it',
    date: '2026-08-29',
    notes: `## See which AI model actually ran

- AI comments now show the model next to the provider — "Claude · Sonnet 4.5" instead of just "Claude". The plugin records the model the CLI actually ran, not only the alias you picked, so "sonnet" resolves to the real version on the card. Shown in the timeline and Reader Mode for comments generated from this version on.

## Tag deletions now sync

- Deleting a tag in Obsidian removes it on the server and your other devices too, and tags deleted elsewhere now disappear here as well — including removals from individual archives. Deletions made while offline are queued and applied when you reconnect.

## Windows: Claude CLI found reliably

- The plugin now detects Claude Code installed with the native Windows installer, so AI comments stop reporting the provider as missing even though the terminal sees it.
- When a provider genuinely is not installed on this device, the job is handed to another of your devices instead of failing outright.`,
  },
  '4.7.1': {
    title: 'Lighter background polling',
    date: '2026-08-18',
    notes: `## One background check instead of three

- The desktop executor used to ask the server about AI-comment, AI-action and transcription work in three separate requests every few minutes. It now asks once and gets all three answers together. Jobs still arrive instantly over the live connection — the background check is only the safety net, and it now costs a third of the requests.
- If the server cannot serve the combined check yet, the plugin quietly falls back to the old per-kind checks, so nothing changes for you either way.

## Small fix

- Switching back to Obsidian mid-check could kick off a duplicate background sweep. Only one runs now.`,
  },
  '4.7.0': {
    title: 'Safer tags, sounder notes',
    date: '2026-08-16',
    notes: `## Tags stay readable in Obsidian

- Tag names can contain a space, and Obsidian's own tag field cannot. Mirroring used to copy them across anyway, so a tag could land in your note struck through in red. Only names Obsidian accepts are mirrored now — the full name is still kept on the archive and still shows in the timeline.
- The tag picker no longer offers the tags the plugin generates for you (the \`archive/…\` style tag from **Settings → Frontmatter**). Picking one used to turn it into a real tag that then spread to every matching note and to your phone.

## Notes with unusual titles no longer break

- A tag or title starting with certain punctuation could break a note's whole properties block — Obsidian showed the note's frontmatter as invalid. Those values are quoted properly now. This applies to notes written from here on; a note already broken this way needs the offending line fixed by hand or the post re-archived.

## Sync

- **Settings → Mobile sync** now lists which notes are behind an "Ambiguous" match, instead of only counting them. This happens when two notes claim the same archive, usually because an author's display name changed between saves.
- Fixed a case where an archive created while a sync was running could be skipped by every later sync.
- Fixed Facebook reels arriving twice under different share links.
`,
  },
  '4.6.9': {
    title: 'Tags from your phone reach your vault',
    date: '2026-08-13',
    notes: `## Tags from your phone reach your vault

- Tags you add in the mobile app now arrive in your vault. Until now they only landed if Obsidian happened to be open at that exact moment — tag something with Obsidian closed and it never showed up. The plugin now catches up on every start, so tags added on any device are waiting for you.
- Your existing tags are safe: catch-up only **adds** tags, it never removes what is already on a note.
- To see them in Obsidian's own tag pane and searches, turn on **Settings → Frontmatter → Mirror archive tags to Obsidian tags**. It applies to your existing notes too, not just new ones.
- Fixed a bug in that mirroring: if you wrote your tags on one line (\`tags: work, reading\`) instead of as a list, turning mirroring on erased them. Please update before enabling it.

## Korean settings

- The settings screen is now in Korean when Obsidian's display language is Korean. Everything else stays as it was.
`,
  },
  '4.6.8': {
    title: 'Deleted notes stay deleted',
    date: '2026-08-09',
    notes: `## Deleted notes stay deleted

- Deleting an archive note (or a whole folder) from your vault no longer comes back on the next sync. The plugin now remembers local deletions and stops re-importing those archives — the server copies stay untouched for your other devices.
- Re-archiving the same post from another device still arrives normally; only unchanged server copies stay hidden.
- **Deletions made before this update are not remembered.** If old archives keep reappearing, delete them once more after updating — from then on they stay gone.

## Disconnect stays disconnected

- Disconnecting this vault under **Settings → Mobile sync** used to be silently undone the next time you signed in. Signing in no longer re-enables sync by itself — the vault reconnects only when you press Connect.
`,
  },
  '4.6.1': {
    title: 'Mosaic view',
    date: '2026-08-02',
    notes: `## Mosaic view

- The timeline's view switcher now cycles through three layouts: **Timeline → Gallery → Mosaic**. Mosaic lays every post out as a moodboard of variable-height cards — like Eagle or Raindrop.
- Unlike the media gallery, mosaic shows **all posts**: text-only posts render as a text tile with the title and an excerpt, so nothing disappears just because it has no image.
- Every card keeps a visible footer (platform, title, author) — no hover needed, so it works on Obsidian mobile and iPad.
- A card-size slider sits where the gallery's group-by control is; drag it to zoom tiles between compact and roomy. Your search, filters, and tag chips all apply to the mosaic exactly as they do to the timeline.
- Click any card to open its note.
`,
  },
  '4.6.0': {
    title: 'Places',
    date: '2026-07-30',
    notes: `## Browse by place

- The timeline toolbar has a map-pin button. It gathers every archive that has a place attached, grouped one row per place with a count, and picking a place filters the timeline to it.
- Filter by place type or map provider, and search by name or address.
- Switch the panel to a map with the **Map** button beside the search box. Markers show where your places are; names appear as you zoom in, and clicking one filters the timeline just like a row does.
- **Places attached to ordinary posts are findable at last.** Most saved places do not sit on a map archive — they are attached to a Threads or Facebook post — and until now nothing could list them. Filtering by the Google/Naver/Kakao platform chips only ever reached the handful that were map archives themselves.

## First launch after this update

- The archive index rebuilds so places become filterable, and your library syncs once in full so places confirmed on another device while Obsidian was closed reach this vault.

## Fixes

- A place's type no longer goes stale. Changing the place on an archive kept the previous type, so the icon described somewhere the note no longer pointed at.
- Instagram Saved imports stop when your quota runs out instead of continuing, report a truthful final status, and say which media could not be fetched and why.
`,
    isImportant: true,
  },
  '4.5.0': {
    title: 'Shopping',
    date: '2026-07-30',
    notes: `## Shopping

- Product pages you archive now render as shopping cards — photo, price, discount, stock, store — instead of a page title. Open the timeline and click the shopping-bag icon to browse them, filtered by store.
- Commerce data was already arriving from the server and being dropped when the note was written, so these cards never appeared for anything in your vault. They do now.
- Prices that arrive after archiving reach your vault too. Coupang, Amazon and Naver do not publish a price a server can read, so it is captured later on another device — that now syncs in rather than being lost.

## First launch after this update

- Your library syncs once in full so existing shop archives pick up their prices and photos. On a large vault this takes a while; the sync banner shows progress.
- Notes now record **when you archived them** rather than when this vault downloaded them. If you sort by "Archived" or group by date, expect a one-time reshuffle — the dates are more accurate now, not less.

## Fixes

- Upgrading an archive to a richer version no longer discards your tags, share links, or per-file media choices. This could break a published share link.
- The "In stock" badge was invisible: Obsidian uses one colour for both the badge background and its text.
- A webtoon episode saved twice no longer risks showing the empty copy.
`,
    isImportant: true,
  },
  '4.4.0': {
    title: 'Faster AI Place Review',
    date: '2026-07-25',
    notes: `## Faster AI place review

- Find Places now searches, matches, and selects likely results automatically, so most posts are ready to save as soon as the review opens.
- Place context from the original post can be saved as a note, with the address and inferred place type available for review before saving.
- Unmatched suggestions can be searched and resolved inline without opening another modal, and matched results survive an app reload.
- OCR and archived-comment extraction are available as compact options within the Find Places flow.
- Multi-place saves continue in the background with clear progress feedback, then refresh the post and Places view without requiring a manual reload.
`,
    isImportant: true,
  },
  '4.0.0': {
    title: 'Browser Clips & Local-Only Mode',
    date: '2026-06-11',
    notes: `## Browser clips & local-only mode

- Clip posts straight into your vault from the Social Archiver Chrome extension — no account needed.
- Clips stay local-only: they never touch the server and never use your monthly archive quota.
- Signed in? Import local clips to your account (media included) anytime from Settings → Local archives, or right-click a clip note → "Upload archive to account". On paid plans, new clips can upload automatically.
- The plugin now works fully logged out — timeline, tags, and settings included.
- Install or update the Chrome extension to **1.6.1** for the full clip platform set: X, Threads, Instagram, Facebook, Reddit, TikTok, Bluesky, Mastodon, LinkedIn, Substack notes, Naver Blog/Cafe, Kakao Brunch, and ordinary web pages.
`,
  },
  '3.9.0': {
    title: 'Linked Archives & Note Mentions',
    date: '2026-06-07',
    notes: `## Linked archives & note mentions

- Mobile notes now appear on timeline cards, including \`@author\` and post mentions added in the mobile app.
- Mentions in synced notes become [[wikilinks]] when the target note exists in your vault.
- A new managed "Linked archives" section connects related archives with [[wikilinks]] — relations show up in Obsidian graph view and on timeline cards.
- Links you archived from an article body convert to [[wikilinks]] in place (the visible text never changes, so highlights stay intact).
- Reader mode: clicking a wikilink jumps the reader to that post instead of leaving the overlay.
- Clicking an \`@author\` mention opens the Author Detail view.
- A one-time backfill upgrades previously synced notes automatically after the update.
`,
  },
  '3.8.2': {
    title: 'Threads Connection Visibility',
    date: '2026-05-25',
    notes: `## Threads Connection Visibility

- Threads connection problems now show actionable warnings in Cross-posting settings and the timeline status banner instead of only logging to the console.
- Revoked, disconnected, expired, server-error, and API-unreachable Threads states now pause cross-posting until the account/API state is usable again.
- Reddit references are linkified more consistently across timeline cards, comments, Markdown conversion, and saved note formatting.
- AI comments now show clearer local/cloud model labels in timeline, reader mode, CLI output, and Markdown metadata.
- Obsidian login magic links now include plugin source tags for cleaner auth attribution.
`,
  },
  '3.8.1': {
    title: 'Supertonic 3 Language Detection',
    date: '2026-05-24',
    notes: `## Supertonic 3 Language Detection

- Reader Mode and timeline TTS now detect more Supertonic 3 languages before playback.
- The TTS language override menu now exposes the full Supertonic 3 language set.
- Supertonic language support is shared from one source of truth, so detection, settings, and provider fallback stay aligned.
`,
  },
  '3.8.0': {
    title: 'Supertonic 3 On-Device TTS',
    date: '2026-05-24',
    notes: `## Supertonic 3 On-Device TTS

- Supertonic on-device TTS now uses Supertonic 3.
- Local language support expands from 5 languages to 31 languages, including Japanese, German, Italian, Dutch, Polish, Russian, Turkish, Ukrainian, Vietnamese, Arabic, Hindi, and more.
- Existing Supertonic 2 installs can update from Settings without uninstalling first.
- The installer stages the new runtime and model files before replacing the existing local engine.
`,
    isImportant: true,
  },
  '3.7.0': {
    title: 'Video Download Reliability',
    date: '2026-05-23',
    notes: `## Video Download Reliability

- YouTube downloads can now run as desktop download-only jobs and update the existing archive note/timeline when media is ready.
- Mobile handoff now reflects desktop-downloaded media after expired CDN refreshes.
- Failed or expired queue activity can be cleared so stale badges do not remain.
- Release notes can now be opened from Settings, with a shared web hub for cross-platform updates.
- Reader CSS cleanup for current Obsidian review checks.
`,
  },
  '3.6.6': {
    title: 'Mobile AI Workflows',
    date: '2026-05-18',
    notes: `## Mobile AI Workflows

- Mobile AI comment and AI action requests now work through a capable desktop Obsidian plugin environment, then sync results back across clients.
- AI actions include content translation variants, tag suggestions, and language-aware timeline/reader rendering.
- Mobile transcription requests can be handed off to Obsidian and receive completed transcript results back through sync.
- Improved AI job backlog recovery, executor targeting, and realtime reconnect stability.
`,
    isImportant: true,
  },
  '3.6.1': {
    title: 'Obsidian Review Polish',
    date: '2026-05-13',
    notes: `## Obsidian Review Polish

- Fixed the mobile bulk toolbar select button so it matches the other icon buttons.
- Removed the duplicate media-gallery selector warning.
- Includes the 3.6.0 review cleanup: Obsidian 1.10.0 metadata, popout-safe DOM globals, \`requestUrl\` networking, safer timers, inline-style cleanup, and CSS review-warning cleanup.
- No intended feature or workflow changes.
`,
  },
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
