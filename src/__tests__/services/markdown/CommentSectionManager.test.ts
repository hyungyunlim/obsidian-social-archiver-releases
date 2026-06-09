import { describe, expect, it } from 'vitest';
import {
  replaceCommentsSection,
  removeCommentsSection,
  findCommentsSection,
} from '@/services/markdown/CommentSectionManager';

/**
 * CommentSectionManager — managed `## 💬 Comments` section replace/remove.
 *
 * The comments section is mid-file and unmarked. The boundary is the FIRST of
 * {next ## H2, metadata footer}. It must NEVER split on bare `---` (the comment
 * body itself uses `\n\n---\n\n` between top-level comments).
 */

const FOOTER =
  '---\n\n**Platform:** Reddit | **Author:** testuser | **Published:** 2026-06-09\n\n**Original URL:** https://example.com/post\n';

function commentsBody(): string {
  // Two top-level comments separated by the literal `---` rule the formatter
  // emits between roots — the manager must not treat this as a section boundary.
  return [
    '**alice** · 1 likes',
    'First comment.',
    '',
    '---',
    '',
    '**bob**',
    'Second comment.',
    '',
    '  ↳ **carol**',
    '  A reply.',
  ].join('\n');
}

function noteWithComments(): string {
  return [
    '---',
    'platform: reddit',
    'author: testuser',
    '---',
    '',
    'Post body text.',
    '',
    '---',
    '',
    '## 💬 Comments',
    '',
    commentsBody(),
    '',
    '---',
    '',
    '**Platform:** Reddit | **Author:** testuser | **Published:** 2026-06-09',
    '',
    '**Original URL:** https://example.com/post',
    '',
  ].join('\n');
}

describe('CommentSectionManager.replaceCommentsSection', () => {
  it('removes stale deleted comments from the managed section', () => {
    const before = noteWithComments();
    expect(before).toContain('First comment.');
    expect(before).toContain('Second comment.');

    // New server state: only "bob" survived a delete of "alice".
    const newBody = ['**bob**', 'Second comment.'].join('\n');
    const after = replaceCommentsSection(before, newBody);

    expect(after).toContain('## 💬 Comments');
    expect(after).toContain('Second comment.');
    expect(after).not.toContain('First comment.');
    expect(after).not.toContain('A reply.');
    // Footer and body preserved.
    expect(after).toContain('Post body text.');
    expect(after).toContain('**Platform:** Reddit');
    expect(after).toContain('**Original URL:** https://example.com/post');
  });

  it('does not split on the `---` rule between top-level comments', () => {
    const before = noteWithComments();
    const section = findCommentsSection(before);
    expect(section).not.toBeNull();

    // The detected section must encompass BOTH comments (it must not stop at the
    // first `---` inside the comment body).
    const sliced = before.slice(section!.start, section!.end);
    expect(sliced).toContain('First comment.');
    expect(sliced).toContain('Second comment.');
    expect(sliced).toContain('A reply.');
    // It must NOT reach into the metadata footer.
    expect(sliced).not.toContain('**Platform:** Reddit');
  });

  it('replaces a Substack-style comments-immediately-followed-by-footer note without eating the footer (no AI section)', () => {
    // No AI section, no transcript — comments section is directly followed by the
    // metadata footer. The boundary must land on the footer regex, not the bare
    // `---` separating the two top-level comments.
    const before = [
      '---',
      'platform: substack',
      '---',
      '',
      'Note body.',
      '',
      '---',
      '',
      '## 💬 Comments',
      '',
      '**alice**',
      'Keep me.',
      '',
      '---',
      '',
      '**bob**',
      'Delete me.',
      '',
      '---',
      '',
      '**Platform:** Substack | **Author:** writer | **Published:** 2026-06-09',
      '',
      '**Original URL:** https://writer.substack.com/p/x',
      '',
    ].join('\n');

    const after = replaceCommentsSection(before, ['**alice**', 'Keep me.'].join('\n'));

    expect(after).toContain('Keep me.');
    expect(after).not.toContain('Delete me.');
    // Footer survived intact.
    expect(after).toContain('**Platform:** Substack | **Author:** writer');
    expect(after).toContain('**Original URL:** https://writer.substack.com/p/x');
    // Exactly one comments heading remains.
    expect(after.match(/## 💬 Comments/g)).toHaveLength(1);
  });

  it('preserves an AI comment section and a mobile annotation block after the comments section', () => {
    const before = [
      '---',
      'platform: reddit',
      '---',
      '',
      'Body.',
      '',
      '---',
      '',
      '## 💬 Comments',
      '',
      '**alice**',
      'Stale comment.',
      '',
      '## 🤖 AI Analysis',
      '',
      '**Summary:** Something insightful.',
      '',
      '<!-- social-archiver:annotations:start -->',
      '## Mobile Annotations',
      '> My note.',
      '<!-- social-archiver:annotations:end -->',
      '',
      '---',
      '',
      '**Platform:** Reddit | **Author:** testuser | **Published:** 2026-06-09',
      '',
    ].join('\n');

    const after = replaceCommentsSection(before, ['**alice**', 'Fresh comment.'].join('\n'));

    expect(after).toContain('Fresh comment.');
    expect(after).not.toContain('Stale comment.');
    // AI section untouched.
    expect(after).toContain('## 🤖 AI Analysis');
    expect(after).toContain('**Summary:** Something insightful.');
    // Annotation block untouched.
    expect(after).toContain('<!-- social-archiver:annotations:start -->');
    expect(after).toContain('## Mobile Annotations');
    expect(after).toContain('> My note.');
    expect(after).toContain('<!-- social-archiver:annotations:end -->');
  });

  it('removes the section when replacing with an empty body', () => {
    const before = noteWithComments();
    const after = replaceCommentsSection(before, '   \n  ');

    expect(after).not.toContain('## 💬 Comments');
    expect(after).not.toContain('First comment.');
    // Surrounding content preserved.
    expect(after).toContain('Post body text.');
    expect(after).toContain('**Platform:** Reddit');
  });

  // ── Regression: vault-content-corruption (2026-06) ─────────────────────────
  //
  // A REAL multi-line comment whose text contains a line like `## foo` plus inner
  // `---` separators must NOT be mistaken for a section boundary. With the old
  // bare-`\n## ` boundary, the fake `## foo` heading matched FIRST: the section
  // was truncated there, and on replace the stale tail (incl. supposedly-deleted
  // comments + a real following managed section) was re-appended BELOW the new
  // section — deleted content survived AND was duplicated.
  it('does not truncate at a `## foo` heading inside a comment body, and preserves the AI section + footer with no duplicated/stale fragment', () => {
    const before = [
      '---',
      'platform: reddit',
      '---',
      '',
      'Post body text.',
      '',
      '---',
      '',
      '## 💬 Comments',
      '',
      '**alice**',
      'Here is a fenced thought:',
      '## foo',                 // looks like an H2 but is comment text
      'still part of the same comment.',
      '',
      '---',                    // inner rule between top-level comments
      '',
      '**bob** (DELETE ME)',
      'This whole comment is being removed by the server.',
      '## bar',                 // another fake heading inside the deleted comment
      '',
      '---',                    // inner rule
      '',
      '**carol**',
      'Trailing comment.',
      '',
      '## 🤖 AI Analysis',      // the FIRST real managed boundary
      '',
      '**Summary:** Real AI summary that must survive verbatim.',
      '',
      '---',
      '',
      '**Platform:** Reddit | **Author:** testuser | **Published:** 2026-06-09',
      '',
      '**Original URL:** https://example.com/post',
      '',
    ].join('\n');

    // findCommentsSection must extend the section to the AI heading (not the fake
    // `## foo`/`## bar` lines), and report a confident managed-heading boundary.
    const section = findCommentsSection(before);
    expect(section).not.toBeNull();
    expect(section!.endBoundary).toBe('managed-heading');
    expect(section!.endIsConfident).toBe(true);
    const sliced = before.slice(section!.start, section!.end);
    expect(sliced).toContain('## foo');
    expect(sliced).toContain('## bar');
    expect(sliced).toContain('Trailing comment.');
    expect(sliced).not.toContain('🤖 AI Analysis');
    expect(sliced).not.toContain('**Platform:** Reddit');

    // Server delete: only alice + carol survive (bob removed). Note the new body
    // also contains a `## foo` line to prove the rewrite is idempotent against it.
    const newBody = [
      '**alice**',
      'Here is a fenced thought:',
      '## foo',
      'still part of the same comment.',
      '',
      '---',
      '',
      '**carol**',
      'Trailing comment.',
    ].join('\n');

    const after = replaceCommentsSection(before, newBody);

    // The real AI section + footer survive verbatim.
    expect(after).toContain('## 🤖 AI Analysis');
    expect(after).toContain('**Summary:** Real AI summary that must survive verbatim.');
    expect(after).toContain('**Platform:** Reddit | **Author:** testuser');
    expect(after).toContain('**Original URL:** https://example.com/post');

    // The deleted comment is GONE and not duplicated anywhere.
    expect(after).not.toContain('DELETE ME');
    expect(after).not.toContain('This whole comment is being removed by the server.');
    expect(after).not.toContain('## bar');

    // Exactly one comments heading and exactly one AI heading — no stale tail
    // re-appended below the rewritten section.
    expect(after.match(/## 💬 Comments/g)).toHaveLength(1);
    expect(after.match(/## 🤖 AI Analysis/g)).toHaveLength(1);
    expect(after.match(/Trailing comment\./g)).toHaveLength(1);

    // The AI section + footer must stay AFTER the comments section (ordering
    // preserved, nothing re-appended past the footer).
    const aiIdx = after.indexOf('## 🤖 AI Analysis');
    const commentsIdx = after.indexOf('## 💬 Comments');
    const footerIdx = after.indexOf('**Platform:** Reddit');
    expect(commentsIdx).toBeLessThan(aiIdx);
    expect(aiIdx).toBeLessThan(footerIdx);
    // Nothing after the footer's Original URL line.
    expect(after.trimEnd().endsWith('https://example.com/post')).toBe(true);
  });

  it('replaces a comments-then-footer note whose body contains `## foo` without eating the footer or leaving a fragment (no AI section)', () => {
    const before = [
      '---',
      'platform: substack',
      '---',
      '',
      'Note body.',
      '',
      '---',
      '',
      '## 💬 Comments',
      '',
      '**alice**',
      'Keep me.',
      '## foo',                 // fake heading inside a kept comment
      '',
      '---',
      '',
      '**bob**',
      'Delete me.',
      '',
      '---',
      '',
      '**Platform:** Substack | **Author:** writer | **Published:** 2026-06-09',
      '',
      '**Original URL:** https://writer.substack.com/p/x',
      '',
    ].join('\n');

    const section = findCommentsSection(before);
    expect(section).not.toBeNull();
    // No managed heading before the footer → footer is the boundary.
    expect(section!.endBoundary).toBe('footer');
    expect(section!.endIsConfident).toBe(true);

    const after = replaceCommentsSection(
      before,
      ['**alice**', 'Keep me.', '## foo'].join('\n'),
    );

    expect(after).toContain('Keep me.');
    expect(after).toContain('## foo');
    expect(after).not.toContain('Delete me.');
    expect(after).toContain('**Platform:** Substack | **Author:** writer');
    expect(after).toContain('**Original URL:** https://writer.substack.com/p/x');
    expect(after.match(/## 💬 Comments/g)).toHaveLength(1);
  });
});

describe('CommentSectionManager.removeCommentsSection', () => {
  it('removes the section and its leading separator when comments become empty', () => {
    const before = noteWithComments();
    const after = removeCommentsSection(before);

    expect(after).not.toContain('## 💬 Comments');
    expect(after).not.toContain('First comment.');
    expect(after).not.toContain('Second comment.');
    // Body + footer survive.
    expect(after).toContain('Post body text.');
    expect(after).toContain('**Platform:** Reddit');
    expect(after).toContain('**Original URL:** https://example.com/post');
  });

  it('removes a Substack-style comments-then-footer section without eating the footer', () => {
    const before = [
      'Body.',
      '',
      '---',
      '',
      '## 💬 Comments',
      '',
      '**alice**',
      'Bye.',
      '',
      '---',
      '',
      '**Platform:** Substack | **Author:** writer | **Published:** 2026-06-09',
      '',
    ].join('\n');

    const after = removeCommentsSection(before);

    expect(after).not.toContain('## 💬 Comments');
    expect(after).not.toContain('Bye.');
    expect(after).toContain('**Platform:** Substack | **Author:** writer');
    expect(after).toContain('Body.');
  });

  it('returns the input unchanged when there is no comments section', () => {
    const before = 'Body.\n\n---\n\n**Platform:** X | **Author:** u | **Published:** 2026-06-09\n';
    expect(removeCommentsSection(before)).toBe(before);
  });

  // ── Regression: vault-content-corruption (2026-06) ─────────────────────────
  it('removes ONLY the comments section even when a comment body contains `## foo` + inner `---`, leaving the AI section + footer intact with no orphaned fragment', () => {
    const before = [
      '---',
      'platform: reddit',
      '---',
      '',
      'Post body text.',
      '',
      '---',
      '',
      '## 💬 Comments',
      '',
      '**alice**',
      'A thought:',
      '## foo',                 // fake heading inside the comment
      'more of the same comment.',
      '',
      '---',                    // inner rule between comments
      '',
      '**bob**',
      'Second comment.',
      '## bar',                 // another fake heading
      '',
      '## 🤖 AI Analysis',      // real managed boundary
      '',
      '**Summary:** Keep this AI summary.',
      '',
      '---',
      '',
      '**Platform:** Reddit | **Author:** testuser | **Published:** 2026-06-09',
      '',
      '**Original URL:** https://example.com/post',
      '',
    ].join('\n');

    const after = removeCommentsSection(before);

    // Comments section + everything inside it (incl. the fake headings) removed.
    expect(after).not.toContain('## 💬 Comments');
    expect(after).not.toContain('A thought:');
    expect(after).not.toContain('Second comment.');
    expect(after).not.toContain('## foo');
    expect(after).not.toContain('## bar');

    // The real AI section + footer survive — no orphaned comment fragment.
    expect(after).toContain('## 🤖 AI Analysis');
    expect(after).toContain('**Summary:** Keep this AI summary.');
    expect(after).toContain('Post body text.');
    expect(after).toContain('**Platform:** Reddit | **Author:** testuser');
    expect(after).toContain('**Original URL:** https://example.com/post');

    // Exactly one AI heading; comments heading fully gone.
    expect(after.match(/## 🤖 AI Analysis/g)).toHaveLength(1);
    expect(after.match(/## 💬 Comments/g)).toBeNull();
  });
});

describe('CommentSectionManager.findCommentsSection — END-boundary confidence', () => {
  it('flags an EOF boundary as NOT confident when a `## foo` comment line follows and no footer/known heading bounds it', () => {
    const md = [
      '## 💬 Comments',
      '',
      '**alice**',
      'Comment text.',
      '## foo',                 // user line inside a comment body, not a managed heading
      'still the same comment.',
    ].join('\n');

    const section = findCommentsSection(md);
    expect(section).not.toBeNull();
    // `## foo` is not allowlisted, so the section runs to EOF. But the parser
    // CANNOT distinguish a `## foo` comment-body line (safe to replace) from a
    // foreign `## …` section a user appended below comments (must be preserved) —
    // they are byte-identical to it. With no footer or recognised managed heading
    // to anchor the end, the only safe choice is to treat the EOF boundary as NOT
    // confident so CommentStateSyncService aborts rather than risk overwriting
    // user content. Real archive notes always carry the `**Platform:**` footer and
    // hit the confident `footer` boundary, so this conservative path only affects
    // footer-less / hand-edited notes, where skipping the projection update is
    // strictly safer than corrupting the body.
    expect(section!.endBoundary).toBe('eof');
    expect(section!.endIsConfident).toBe(false);
    expect(section!.end).toBe(md.length);
  });

  it('flags an EOF boundary as NOT confident when an unrecognised `## ` managed-looking heading follows but no footer/known heading is present', () => {
    // No footer, no allowlisted heading — but a foreign `## 🧩 Plugin Section`
    // (some OTHER plugin's managed block) sits after the comments. The detector
    // cannot tell where the comments end vs. the foreign section begins, so it
    // must mark the boundary as NOT confident → the sync service will abort.
    const md = [
      '## 💬 Comments',
      '',
      '**alice**',
      'Comment text.',
      '',
      '## 🧩 Plugin Section',    // unknown / foreign managed heading
      '',
      'Some other plugin owns this.',
    ].join('\n');

    const section = findCommentsSection(md);
    expect(section).not.toBeNull();
    expect(section!.endBoundary).toBe('eof');
    expect(section!.endIsConfident).toBe(false);
  });

  it('keeps confidence true for a recognised managed-heading boundary even without a footer', () => {
    const md = [
      '## 💬 Comments',
      '',
      '**alice**',
      'Hi.',
      '',
      '## Transcript',           // allowlisted (standalone transcript append)
      '',
      'transcript text',
    ].join('\n');

    const section = findCommentsSection(md);
    expect(section).not.toBeNull();
    expect(section!.endBoundary).toBe('managed-heading');
    expect(section!.endIsConfident).toBe(true);
    const sliced = md.slice(section!.start, section!.end);
    expect(sliced).toContain('Hi.');
    expect(sliced).not.toContain('transcript text');
  });
});

describe('CommentSectionManager.findCommentsSection', () => {
  it('returns null when the emoji heading is absent (plain `## Comments` is never produced)', () => {
    const md = 'Body.\n\n## Comments\n\n**alice**\nHi.\n';
    expect(findCommentsSection(md)).toBeNull();
  });

  it('bounds the section at the next H2 when there is no footer', () => {
    const md = [
      '## 💬 Comments',
      '',
      '**alice**',
      'Hi.',
      '',
      '## Transcript',
      '',
      'transcript text',
    ].join('\n');

    const section = findCommentsSection(md);
    expect(section).not.toBeNull();
    const sliced = md.slice(section!.start, section!.end);
    expect(sliced).toContain('Hi.');
    expect(sliced).not.toContain('transcript text');
  });
});
