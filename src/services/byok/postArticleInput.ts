/**
 * What chat and research tell a model about one archived post, as
 * byok-ai-core's ByokArticleInput: the body with quoted and embedded posts,
 * the transcript, text read from its images, and a comments digest.
 */
import { buildCommentsDigest, type ByokArticleInput } from '../../vendor/byok-ai-core';
import type { PostData } from '../../types/post';

/** Mobile's OCR notes, matched the way workers reads them (extractOCRImageTextContext). */
const OCR_NOTE_TITLE = /Extracted Text \(Image \d+\)/;

export function buildPostArticleInput(post: PostData): ByokArticleInput {
  const transcript =
    post.transcript?.raw?.trim() ||
    post.transcript?.formatted?.map((entry) => entry.text).join(' ').trim() ||
    post.whisperTranscript?.segments.map((segment) => segment.text).join(' ').trim();
  return {
    title: post.title,
    authorName: post.author?.name,
    platform: post.platform,
    url: post.originalUrl || post.url,
    body: postBody(post),
    transcript,
    ocrText: (post.userNotes ?? []).map((note) => ocrNoteText(note.content)).filter(Boolean).join('\n\n'),
    commentsText: post.comments?.length ? buildCommentsDigest(post.comments) : undefined,
  };
}

/** The post's own text, then a quoted post and embedded archives (as AI comments read them). */
function postBody(post: PostData): string {
  const parts = [post.content.rawMarkdown || post.content.text || ''];
  const quoted = post.quotedPost;
  if (quoted?.content.text) parts.push(`[Quoted ${quoted.platform} post by ${quoted.author?.name || 'unknown'}]\n${quoted.content.text}`);
  for (const embed of post.embeddedArchives ?? []) {
    const text = embed.platform === 'youtube' && embed.transcript?.raw ? embed.transcript.raw : embed.content.text || '';
    if (text.trim()) parts.push(`[Embedded ${embed.platform}: ${embed.title || 'Post'}]\n${text}`);
  }
  return parts.map((part) => part.trim()).filter(Boolean).join('\n\n');
}

function ocrNoteText(content: string): string {
  const lines = content.split(/\r?\n/);
  const title = lines.findIndex((line) => OCR_NOTE_TITLE.test(line));
  return title === -1 ? '' : lines.slice(title + 1).join('\n').trim();
}
