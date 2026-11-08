/**
 * Maps between a composed post's vault note and the server row
 * (prd-plugin-my-posts-two-way-sync §3, §5.5, §5.6). Pure string work.
 *
 * The note's post text is what the server stores as `fullContent`, plus the
 * trailing archive-mention lines the server keeps as `embeddedArchives`. The
 * fingerprint is always computed from the note as written, never from
 * MetadataCache, so a note just rewritten from the server reads as unchanged.
 */

import { parseYaml } from 'obsidian';
import type { UserArchive } from '../../../services/WorkersAPIClient';
import { stripHighlightMarks } from '../../../components/timeline/reader/ReaderHighlightManager';
import { COMPOSED_MEDIA_NOTE_TYPES } from '../../../utils/composedPostNote';
import { joinArchiveRefLines, splitArchiveRefLines } from '../../../utils/note-mentions';
import { isImageUrl, isVideoUrl } from '../../../utils/mediaType';
import { decodePathFromMarkdownLink } from '../../../utils/url';

export interface ComposedAttachmentRef {
  /** Link target as written (`![](…)` decoded via decodePathFromMarkdownLink). */
  target: string;
  /** http(s) URL. */
  remote: boolean;
}

export interface ComposedNoteParts {
  /** Frontmatter `title`, not the leading H1. */
  title: string | null;
  /** The post text sent as fullContent. */
  text: string;
  /** Inline local media embeds (note order), then gallery entries. */
  attachments: ComposedAttachmentRef[];
  hasCrlf: boolean;
  /**
   * The author line that ends the post part is there. Without it the post
   * part would run into the plugin-owned blocks below (AI comments, linked
   * archives, annotations, place blocks), and updatePost cannot rewrite it.
   */
  hasFooter: boolean;
}

/** CRLF notes and notes whose author line was deleted stay out of two-way sync (PRD §8). */
export function isSyncableComposedNote(parts: Pick<ComposedNoteParts, 'hasCrlf' | 'hasFooter'>): boolean {
  return !parts.hasCrlf && parts.hasFooter;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
/** The interaction bar every post note ends its post part with (same anchor as VaultStorageService.updatePost). */
const AUTHOR_LINE = '\n---\n\n**Author:**';
const MY_NOTE_BLOCK = /^> \*\*My Note:\*\*[\s\S]*?\n---\n\n/;
/** Plugin-owned sections written between the post and the author line: referenced archives, platform comments. */
const OWNED_SECTIONS = /(?:\n---\n\s*?)?(?:^|\n)## (?:(?:📦 )?Referenced Social Media Posts|💬 Comments)[^\n]*(?:\n[\s\S]*)?$/;
const SENTINEL_GALLERY = /\n---\n\s*<!-- sa:media:start id=\S+ -->[\s\S]*?<!-- sa:media:end -->/g;
/** The rule a section written above the footer leaves behind (ComposedPostSyncService history). */
const TRAILING_RULES = /(?:(?:^|\n)\s*---)+$/;
const MARKDOWN_EMBED = /!\[(?:\\.|[^\]\\])*\]\(([^)\s]*)\)/g;
const WIKI_EMBED = /!\[\[([^\]]+)\]\]/g;
const MEDIA_LINE = /^(?:!\[(?:\\.|[^\]\\])*\]\(([^)\s]*)\)|!\[\[([^\]]+)\]\])$/;

function isRemote(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

function isMediaTarget(target: string): boolean {
  return isImageUrl(target) || isVideoUrl(target);
}

function wikiTarget(inner: string): string {
  return (inner.split('|')[0] ?? '').trim();
}

function parseFrontmatterBlock(block: string | undefined): Record<string, unknown> | null {
  if (block === undefined) return null;
  try {
    const fm: unknown = parseYaml(block);
    return fm && typeof fm === 'object' && !Array.isArray(fm) ? (fm as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The note's frontmatter parsed from its text: the same snapshot its
 * fingerprint is read from (MetadataCache lags a write). Null when there is
 * none or it does not parse.
 */
export function readNoteFrontmatter(markdown: string): Record<string, unknown> | null {
  return parseFrontmatterBlock(FRONTMATTER.exec(markdown)?.[1]);
}

function readTitle(fm: Record<string, unknown> | null): string | null {
  const title = fm?.['title'];
  return typeof title === 'string' && title.trim() ? title : null;
}

/** A gallery line's target, or null when the line is not exactly one media embed. */
function galleryLineTarget(line: string): string | null {
  const match = MEDIA_LINE.exec(line.trim());
  if (!match) return null;
  return match[1] !== undefined ? decodePathFromMarkdownLink(match[1]) : wikiTarget(match[2] ?? '');
}

function galleryTargets(section: string): string[] | null {
  const targets: string[] = [];
  for (const line of section.split('\n')) {
    if (!line.trim()) continue;
    const target = galleryLineTarget(line);
    if (target === null) return null;
    targets.push(target);
  }
  return targets;
}

/** Splits region R into body and gallery targets. */
function splitGallery(region: string): { body: string; gallery: string[] } {
  const sentinels = [...region.matchAll(SENTINEL_GALLERY)];
  const sentinel = sentinels[sentinels.length - 1];
  if (sentinel) {
    const start = sentinel.index ?? 0;
    const inner = sentinel[0].replace(/^\n---\n\s*<!-- sa:media:start id=\S+ -->/, '').replace(/<!-- sa:media:end -->$/, '');
    return {
      body: region.slice(0, start) + region.slice(start + sentinel[0].length),
      gallery: galleryTargets(inner) ?? [],
    };
  }
  // No sentinel (notes the composer wrote): the last `---` section, when it is
  // only media and at least one is local. A remote-only section stays text, so
  // a remote inline image at the end of a post is not taken for the gallery.
  const cut = region.lastIndexOf('\n---\n');
  if (cut === -1) return { body: region, gallery: [] };
  const targets = galleryTargets(region.slice(cut + 5));
  if (!targets || targets.length === 0 || targets.every(isRemote)) return { body: region, gallery: [] };
  return { body: region.slice(0, cut), gallery: targets };
}

/** Removes local image/video embeds from the body; a line left empty takes one adjacent blank line with it. */
function takeLocalEmbeds(body: string): { text: string; inline: string[] } {
  const inline: string[] = [];
  const lines = body.split('\n');
  const out: string[] = [];
  let dropNextBlank = false;
  for (const line of lines) {
    if (dropNextBlank && !line.trim()) {
      dropNextBlank = false;
      continue;
    }
    dropNextBlank = false;
    const stripped = line
      .replace(MARKDOWN_EMBED, (token, raw: string) => {
        const target = decodePathFromMarkdownLink(raw);
        if (isRemote(target) || !isMediaTarget(target)) return token;
        inline.push(target);
        return '';
      })
      .replace(WIKI_EMBED, (token, raw: string) => {
        const target = wikiTarget(raw);
        if (!isMediaTarget(target)) return token;
        inline.push(target);
        return '';
      });
    if (stripped !== line && !stripped.trim()) {
      // The embed had the line to itself.
      if (out.length > 0 && !(out[out.length - 1] ?? '').trim()) out.pop();
      else dropNextBlank = true;
      continue;
    }
    out.push(stripped);
  }
  return { text: out.join('\n'), inline };
}

/**
 * The post part of a composed note. Note embeds, `[[wikilinks]]`, `^ids` and
 * PDF embeds stay in the text (§5.5). `keepHighlights` leaves the `==marks==`
 * in for display; the fingerprint and push always use the default.
 */
export function readComposedNote(markdown: string, opts?: { keepHighlights?: boolean }): ComposedNoteParts {
  const hasCrlf = markdown.includes('\r\n');
  const frontmatter = FRONTMATTER.exec(markdown);
  const afterFrontmatter = frontmatter ? markdown.slice(frontmatter[0].length) : markdown;
  const authorAt = afterFrontmatter.indexOf(AUTHOR_LINE);
  let region = authorAt === -1 ? afterFrontmatter : afterFrontmatter.slice(0, authorAt);
  region = region.replace(/^\n+/, '').replace(MY_NOTE_BLOCK, '').replace(OWNED_SECTIONS, '');

  const { body, gallery } = splitGallery(region);
  const unmarked = opts?.keepHighlights ? body.replace(/^\n+/, '') : stripHighlightMarks(body.replace(/^\n+/, '')).canonical;
  const { text, inline } = takeLocalEmbeds(unmarked);
  return {
    title: readTitle(parseFrontmatterBlock(frontmatter?.[1])),
    text: text.trimEnd().replace(TRAILING_RULES, '').trimEnd(),
    attachments: [...inline, ...gallery].map((target) => ({ target, remote: isRemote(target) })),
    hasCrlf,
    hasFooter: authorAt !== -1,
  };
}

/** djb2, 32-bit unsigned, hex: fast, no crypto needed. */
export function djb2(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16);
}

/** What a push sends, short of uploading: embeds count by their target. */
export function composedFingerprint(parts: Pick<ComposedNoteParts, 'title' | 'text' | 'attachments'>): string {
  return djb2(JSON.stringify([parts.title, parts.text, parts.attachments.map((a) => a.target)]));
}

/** A composed post row: platform post, archive source composed, not a meeting/audio note. */
export function isComposedServerRow(a: Pick<UserArchive, 'platform' | 'archiveSource' | 'contentType'>): boolean {
  return a.platform === 'post'
    && a.archiveSource === 'composed'
    && !(typeof a.contentType === 'string' && COMPOSED_MEDIA_NOTE_TYPES.has(a.contentType));
}

/** The server row's post text as the note holds it: fullContent plus its archive refs as trailing lines (F1). */
export function serverComposedText(a: Pick<UserArchive, 'fullContent' | 'embeddedArchives'>): string {
  const refs = (a.embeddedArchives ?? []).flatMap((summary) => summary.archiveId
    ? [{ archiveId: summary.archiveId, label: summary.title || summary.authorName || '' }]
    : []);
  return joinArchiveRefLines(a.fullContent ?? '', refs);
}

/** §5.6 normalization: compares text the way the note writer and the server may each have shaped it. */
export function normalizeComposedText(text: string): { body: string; refIds: string[] } {
  const { body, refs } = splitArchiveRefLines(text);
  const normalized = stripHighlightMarks(body).canonical
    .trimEnd()
    .replace(TRAILING_RULES, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(\s*)\\(#+)/gm, '$1$2')
    .replace(/^(\s*\d+)\\\./gm, '$1.')
    .replace(/&lt;/g, '<')
    .replace(/\[#([^\]\s]+)\]\([^)]*\)/g, '#$1')
    .trim();
  return { body: normalized, refIds: refs.map((ref) => ref.archiveId) };
}

export function sameComposedText(a: string, b: string): boolean {
  const left = normalizeComposedText(a);
  const right = normalizeComposedText(b);
  return left.body === right.body && left.refIds.join('\n') === right.refIds.join('\n');
}

/**
 * The media the server last accepted, from frontmatter `syncedMedia`
 * (`<sha256 of the local file>:<r2Url>`, note order) as sha → url. Keyed by
 * content, not path: a pasted `image.png` can take a removed image's path.
 */
export function readSyncedMedia(fm: Readonly<Record<string, unknown>> | null | undefined): Map<string, string> {
  const urls = new Map<string, string>();
  const list = fm?.['syncedMedia'];
  for (const entry of Array.isArray(list) ? (list as unknown[]) : []) {
    if (typeof entry !== 'string') continue;
    const colon = entry.indexOf(':');
    if (colon > 0) urls.set(entry.slice(0, colon), entry.slice(colon + 1));
  }
  return urls;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
