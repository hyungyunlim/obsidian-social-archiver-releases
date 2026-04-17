/**
 * markdown-visible-text.ts — Build bidirectional visible↔full text mapping
 *
 * Pure TypeScript implementation. No DOM / RN / side effects.
 *
 * PRD reference: `.taskmaster/docs/prd-highlight-sync-unification.md` §4.4.
 *
 * Architecture (Phase 2 Stage 1.1 refactor)
 * -----------------------------------------
 * The canonical entry point is {@link alignVisibleTextToFullText}: it aligns
 * an externally-rendered `visibleText` (produced by the client's own markdown
 * renderer — marked, markdown-it, RN marked, etc.) against a canonical
 * `fullText` using a forward-only monotonic matching algorithm.  This is the
 * production path used by share-web, plugin, desktop, and mobile clients.
 *
 * The legacy helper {@link buildVisibleToFullTextMap} is kept for *reference*
 * and for the existing unit test suite — it composes:
 *   1. {@link computeFullText}            (title prefix + normalized body)
 *   2. {@link referenceRenderToVisible}   (strip syntax, apply profile knobs)
 *   3. {@link alignVisibleTextToFullText} (align the reference render to full)
 *
 * All three clients ultimately drive `alignVisibleTextToFullText`, so a single
 * alignment implementation covers both "we rendered this ourselves" and "the
 * DOM/RN renderer handed us this visible text".  No more "by construction"
 * drift: if the client renderer emits a character the aligner can't match,
 * that character is clamped to the nearest mapped fullText position and the
 * returned map records a `driftChars` count for telemetry.
 *
 * Supported inline constructs (reference renderer)
 * ------------------------------------------------
 *   - `` `code` `` — content emitted verbatim, backticks stripped.
 *   - `**strong**` / `*em*` / `__strong__` / `_em_` — delimiters stripped.
 *   - `[text](url)` — rendered as `text`.
 *   - `![alt](url)` — rendered as a single U+FFFC placeholder.
 *   - `<https://...>` autolinks — rendered as inner URL.
 *   - `\\x` escapes — emit the escaped char only.
 *   - Typographer (profile-gated): `---` → `—`, `--` → `–`, `...` → `…`,
 *                                   paired `"..."` / `'...'` → curly quotes.
 *   - GFM (profile-gated, Option A): strikethrough `~~x~~`, task-list
 *                                     `- [ ] item`, pipe tables.
 *
 * Block rendering contract
 * ------------------------
 * The reference renderer emits **`\n\n`** between consecutive blocks,
 * matching CommonMark / markdown-it's `<p></p>` boundary convention. HR
 * itself does not emit its own separator (the next block's separator
 * covers it) to avoid `\n\n\n\n` runs.
 *
 * When a source lacks the second `\n` (e.g. `# Title\nBody`), the aligner
 * absorbs the synthetic newline into `driftChars` and clamps its full-text
 * position to the last mapped offset — callers with `driftChars > 0`
 * should treat the mapping as degraded (telemetry + fallback UX), not as
 * a warning to ignore.  See `alignVisibleTextToFullText` + the unit tests
 * in `__tests__/markdown-visible-text.test.ts` for the contract.
 *
 * Invariants (asserted by tests):
 *   - visibleText.length === map.visibleToFull.length
 *   - fullText.length    === map.fullToVisible.length
 *   - visibleToFull[i]   ∈ [0, fullText.length)
 *   - fullToVisible[j]   ∈ [0, visibleText.length) ∪ {-1}
 *   - The forward map is monotonically non-decreasing.
 */
import { RENDER_PROFILE_CONFIG } from './render-profile';
import { normalizeText } from './text-normalize';
/** Object replacement character used to stand in for images/video blocks. */
export const MEDIA_PLACEHOLDER = '\uFFFC';
/** Separator inserted between title and body when title prefix is enabled. */
export const ARTICLE_TITLE_BODY_SEPARATOR = '\n\n';
// ---------------------------------------------------------------------------
// Title + body composition
// ---------------------------------------------------------------------------
/**
 * Compute canonical fullText = optional title prefix + normalized body.
 *
 * Separator semantics match the mobile implementation: exactly one
 * `ARTICLE_TITLE_BODY_SEPARATOR` between a non-empty title and a non-empty
 * body, nothing if either side is empty.
 */
export function computeFullText(params) {
    const body = normalizeText(params.body ?? '');
    const title = normalizeText(params.title?.trim() ?? '');
    if (!params.includeTitlePrefix || !title)
        return body;
    if (!body)
        return title;
    return `${title}${ARTICLE_TITLE_BODY_SEPARATOR}${body}`;
}
/**
 * Forward-equivalence table used during alignment.  When a visible char has
 * no verbatim match in fullText, try these fallbacks (ordered by preference).
 */
const ALIGNMENT_EQUIVALENTS = {
    // Typographer substitutions — visible may contain the curly char while the
    // source markdown (fullText) still has the ASCII form.
    '\u2014': ['---', '—'], // em dash
    '\u2013': ['--', '–'], // en dash
    '\u2026': ['...', '..', '…'], // ellipsis
    '\u201C': ['"', '\u201C'], // left double quote
    '\u201D': ['"', '\u201D'], // right double quote
    '\u2018': ["'", '\u2018'], // left single quote
    '\u2019': ["'", '\u2019'], // right single quote
    // Media placeholder — visible contains \uFFFC, fullText has the original
    // `![alt](url)` markdown.  Anchor the placeholder onto the leading `!` so
    // the image syntax as a whole maps to a single visible char.
    '\uFFFC': ['!', '\uFFFC'],
    // NOTE: `\n` deliberately omitted from the equivalents table.  The
    // verbatim-match path already handles LF with an explicit
    // `containsNonLineContent` guard that prevents a synthetic second `\n`
    // (block separator) from skipping past real text content.  Adding `\n`
    // here would let the fallback scan bypass that guard via `indexOf`.
};
/**
 * Align an externally-rendered `visibleText` to `fullText` using a forward-only
 * monotonic character-matching algorithm.
 *
 * This is the **canonical** API used in production.  Each client's markdown
 * renderer (share-web `marked`, plugin / desktop `markdown-it`, mobile RN
 * `marked`) is free to emit any visibleText it likes — the aligner reconciles
 * that text against the canonical `fullText` (title prefix + raw markdown)
 * without requiring the two to agree byte-for-byte.
 *
 * Algorithm:
 *   1. Walk `visibleText` left-to-right with cursor `vi`.
 *   2. For each visible char, advance the `fi` cursor in `fullText` forward
 *      until `fullText[fi]` matches the visible char (or an equivalent from
 *      {@link ALIGNMENT_EQUIVALENTS}).
 *   3. Record `visibleToFull[vi] = fi`; all skipped `fullText` positions stay
 *      at their `-1` sentinel in `fullToVisible`.
 *   4. If no match is found within `fullText`, **clamp** the visible char to
 *      the last mapped full position and increment `driftChars` (renderer
 *      inserted a char not present in source — e.g. synthetic `\u2028`).
 *
 * Complexity: O(|fullText| + |visibleText|) amortized.
 *
 * @param params.visibleText  Actual renderer output (markdown syntax stripped).
 * @param params.fullText     Canonical source (`computeFullText(...)` output).
 * @param params.profile      Render profile in effect (currently informational;
 *                            reserved for profile-specific tuning).
 */
export function alignVisibleTextToFullText(params) {
    const { visibleText, fullText } = params;
    // Profile is reserved for future per-profile tuning (e.g. different
    // equivalence tables when typographer is off).  Referenced here so the
    // unused-parameter lint does not flag it.
    void params.profile;
    const vLen = visibleText.length;
    const fLen = fullText.length;
    const visibleToFull = new Int32Array(vLen);
    const fullToVisible = new Int32Array(fLen).fill(-1);
    if (vLen === 0 || fLen === 0) {
        return {
            visibleText,
            fullText,
            visibleToFull,
            fullToVisible,
            driftChars: 0,
        };
    }
    let fi = 0;
    let driftChars = 0;
    let lastMappedFi = 0;
    for (let vi = 0; vi < vLen; vi++) {
        const vc = visibleText[vi];
        // --- Try verbatim match first (fast path) ---------------------------
        // For `\n` we restrict the forward scan so that a synthetic second `\n`
        // emitted by the reference renderer (block separator `\n\n` for sources
        // like `# A\nB`) does NOT skip past intermediate content.  Concretely:
        // if `\n` is found at position p but fullText[fi..p-1] contains any
        // non-`\n` / non-whitespace char, we bail out and treat the visible
        // `\n` as drift — clamping onto `lastMappedFi`.  Without this guard
        // nested lists (`- one\n  - two\n- three`) lose the middle item when
        // the synthetic `\n\n` separator after "one" scans all the way to the
        // real `\n` after "two".
        let matchedFi = -1;
        for (let j = fi; j < fLen; j++) {
            if (fullText[j] === vc) {
                if (vc === '\n' && containsNonLineContent(fullText, fi, j)) {
                    // There is real content between the current cursor and this `\n`.
                    // Treat the visible `\n` as drift (clamp) so we don't skip past
                    // characters that later visible chars still need to anchor onto.
                    break;
                }
                matchedFi = j;
                break;
            }
        }
        // --- Fallback to typographer/ASCII equivalents ----------------------
        if (matchedFi < 0) {
            const equivs = ALIGNMENT_EQUIVALENTS[vc];
            if (equivs) {
                let bestIdx = -1;
                for (const equiv of equivs) {
                    const idx = fullText.indexOf(equiv, fi);
                    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx))
                        bestIdx = idx;
                }
                if (bestIdx >= 0) {
                    matchedFi = bestIdx;
                }
            }
        }
        if (matchedFi >= 0) {
            visibleToFull[vi] = matchedFi;
            if (fullToVisible[matchedFi] === -1) {
                fullToVisible[matchedFi] = vi;
            }
            // Advance `fi` past the consumed source chars.  For a simple char match
            // that's +1; for a multi-char equivalent (`---` → `—`) we must skip the
            // full length of the matched equivalent so the next visible char starts
            // scanning *after* the multi-char island.
            const consumed = computeConsumedLength(vc, fullText, matchedFi);
            fi = matchedFi + consumed;
            lastMappedFi = matchedFi;
        }
        else {
            // Renderer drift — the visible char has no anchor in fullText.  Clamp
            // to the last successful mapping to keep the map monotonic and dense.
            visibleToFull[vi] = lastMappedFi;
            driftChars += 1;
            // Do NOT advance `fi`; subsequent visible chars might still find real
            // anchors ahead of `lastMappedFi`.
        }
    }
    return {
        visibleText,
        fullText,
        visibleToFull,
        fullToVisible,
        driftChars,
    };
}
/**
 * How many `fullText` code units were consumed by mapping this visible char?
 * For typographer collapses (`---` → `—`) the answer is >1 so subsequent
 * visible chars don't greedily match back inside the already-consumed island.
 *
 * Special-case image placeholders: when `\uFFFC` is mapped onto the leading
 * `!` of `![alt](url)`, consume the full `![...](...)` span so subsequent
 * visible chars don't match back inside the link label or URL.
 */
function computeConsumedLength(visibleChar, fullText, matchedFi) {
    // Image placeholder: scan for the full `![alt](url)` extent.
    if (visibleChar === '\uFFFC' && fullText[matchedFi] === '!' && fullText[matchedFi + 1] === '[') {
        const closeBracket = findClosingBracket(fullText, matchedFi + 1);
        if (closeBracket >= 0 && fullText[closeBracket + 1] === '(') {
            const closeParen = fullText.indexOf(')', closeBracket + 2);
            if (closeParen >= 0)
                return closeParen + 1 - matchedFi;
        }
    }
    // Verbatim single-char match: 1 source unit.
    if (fullText[matchedFi] === visibleChar)
        return 1;
    // Multi-char typographer equivalents — pick the longest matching prefix so
    // we skip the whole island (e.g. `---` is 3 chars; `--` is 2).
    const equivs = ALIGNMENT_EQUIVALENTS[visibleChar];
    if (!equivs)
        return 1;
    // Longer equivalents first so we prefer `---` over `--`.
    const ranked = [...equivs].sort((a, b) => b.length - a.length);
    for (const equiv of ranked) {
        if (fullText.startsWith(equiv, matchedFi))
            return equiv.length;
    }
    return 1;
}
/**
 * Does the slice `fullText[from .. to)` contain any non-whitespace or any
 * non-`\n` character that a later visible char might still need to anchor
 * onto?  Used by the `\n` matcher to decide whether to accept a remote LF
 * or bail out and treat the visible `\n` as drift.  Indentation whitespace
 * (spaces / tabs) between two successive list items is invisible markup
 * and should NOT block the match — we only want to guard against skipping
 * past real text content.
 */
function containsNonLineContent(fullText, from, to) {
    for (let k = from; k < to; k++) {
        const ch = fullText[k];
        if (ch === '\n' || ch === ' ' || ch === '\t')
            continue;
        return true;
    }
    return false;
}
/** Internal helper — share bracket matching between alignment and inline tokenizer. */
function findClosingBracket(text, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '[')
            depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    return -1;
}
// ---------------------------------------------------------------------------
// Reference render — used by buildVisibleToFullTextMap internally
// ---------------------------------------------------------------------------
/**
 * Reference markdown → visible-text renderer.  **Not canonical** — production
 * code paths hand {@link alignVisibleTextToFullText} their own renderer's
 * output.  Exists so {@link buildVisibleToFullTextMap} can offer a single-arg
 * convenience helper, and so tests can probe the renderer in isolation.
 *
 * Output shape:
 *   - Strips markdown syntax (delimiters, fences, bullets).
 *   - Replaces images with a single U+FFFC placeholder.
 *   - Emits exactly one `\n` between consecutive blocks (paragraphs, headings,
 *     list items, blockquotes).  This matches the "text content" shape that
 *     `markdown-it` produces when each block's visible output is joined with
 *     a single newline — and more importantly, each emitted `\n` has a real
 *     counterpart in the source fullText, so alignment never has to invent
 *     offsets.
 *   - Applies profile-driven typographer substitutions when enabled.
 *   - Honours GFM features for profiles that declare `gfm: true`: tables
 *     preserve pipes as spaces, strikethrough `~~x~~` strips delimiters,
 *     task-list `- [ ]` strips the checkbox syntax.
 *
 * @param fullText Canonical fullText (title prefix + body, already normalized).
 *                 Passing the unprefixed body is also safe — the renderer
 *                 treats `fullText` as a single markdown document.
 * @param profile  Render profile controlling typographer / gfm / breaks.
 */
export function referenceRenderToVisible(fullText, profile) {
    const cfg = RENDER_PROFILE_CONFIG[profile];
    if (!fullText)
        return '';
    const out = [];
    renderBlocks(fullText, cfg, out);
    return out.join('');
}
// ---------------------------------------------------------------------------
// Public convenience API — back-compat for existing callers
// ---------------------------------------------------------------------------
/**
 * Build the bidirectional visible↔full text map for a markdown document.
 *
 * **Reference / fallback use only.**  Production code should render via the
 * client's own markdown engine and call {@link alignVisibleTextToFullText}
 * directly — that is the only way to detect real renderer drift.  This helper
 * is retained for:
 *   1. Existing unit tests that rely on the reference renderer output.
 *   2. Callers that need a quick visible-text extraction without plumbing a
 *      DOM renderer (e.g. CLI tools, non-interactive tests).
 *
 * Internally this function:
 *   1. Composes `fullText` via {@link computeFullText}.
 *   2. Renders a reference `visibleText` via {@link referenceRenderToVisible}.
 *   3. Aligns the two via {@link alignVisibleTextToFullText}.
 *
 * @param markdown Raw markdown body.  The function internally normalizes
 *                 (NFC / CRLF→LF / BOM strip) defensively.
 * @param title    Optional title prefix — honoured only when the selected
 *                 profile enables `includeTitlePrefix`.
 * @param profile  Render profile that controls typographer / title / breaks.
 */
export function buildVisibleToFullTextMap(markdown, title, profile) {
    const cfg = RENDER_PROFILE_CONFIG[profile];
    const body = normalizeText(markdown ?? '');
    const cleanTitle = cfg.includeTitlePrefix && title && title.trim() ? normalizeText(title.trim()) : '';
    const hasTitlePrefix = cleanTitle.length > 0;
    const fullText = hasTitlePrefix
        ? body
            ? `${cleanTitle}${ARTICLE_TITLE_BODY_SEPARATOR}${body}`
            : cleanTitle
        : body;
    if (!fullText) {
        return {
            visibleText: '',
            fullText: '',
            visibleToFull: new Int32Array(0),
            fullToVisible: new Int32Array(0),
        };
    }
    // Reference render:
    //   - title prefix (when profile enables it) is emitted verbatim with the
    //     literal `\n\n` separator so the visible text matches what long-form
    //     readers (article view) display above the article body.
    //   - body is rendered via the block/inline tokenizer.
    let visibleText;
    if (hasTitlePrefix) {
        const bodyVisible = body ? referenceRenderToVisible(body, profile) : '';
        visibleText = body ? `${cleanTitle}${ARTICLE_TITLE_BODY_SEPARATOR}${bodyVisible}` : cleanTitle;
    }
    else {
        visibleText = referenceRenderToVisible(fullText, profile);
    }
    const aligned = alignVisibleTextToFullText({ visibleText, fullText, profile });
    // Strip the telemetry field to preserve the legacy `VisibleFullTextMap` shape.
    return {
        visibleText: aligned.visibleText,
        fullText: aligned.fullText,
        visibleToFull: aligned.visibleToFull,
        fullToVisible: aligned.fullToVisible,
    };
}
/**
 * Convenience: visibleText only.  Avoids allocating the reverse map when the
 * caller does not need offset conversion.
 */
export function extractVisibleText(markdown, title, profile) {
    return buildVisibleToFullTextMap(markdown, title, profile).visibleText;
}
/**
 * Walk markdown line-by-line, recognizing block-level structures.  Each block
 * emits its visible content followed by a `\n\n` separator (except the first
 * block, which has no leading newline) so the output shape matches what a
 * real CommonMark/GFM renderer produces when blocks are concatenated — two
 * LFs corresponding to the `</block><block>` boundary.  When the aligner
 * encounters a fullText that only contains a single `\n` between blocks
 * (`# Title\nBody`, tight lists, etc.) the synthetic second `\n` is clamped
 * to the previous mapped fullText position and counted as drift; the
 * expectedSamples + expectedFullToVisibleUnmapped invariants still hold.
 */
function renderBlocks(body, cfg, out) {
    // Split body into lines while preserving LF positions.
    const lines = [];
    let cursor = 0;
    for (let i = 0; i <= body.length; i++) {
        if (i === body.length || body[i] === '\n') {
            lines.push(body.slice(cursor, i));
            cursor = i + 1;
            if (i === body.length)
                break;
        }
    }
    let firstBlock = true;
    const emitBlockSeparator = () => {
        if (!firstBlock)
            out.push('\n\n');
        firstBlock = false;
    };
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmedLeft = line.replace(/^\s+/, '');
        // ---- Blank line ------------------------------------------------------
        if (trimmedLeft === '') {
            i++;
            continue;
        }
        // ---- Fenced code block ----------------------------------------------
        const fenceMatch = /^(\s{0,3})(`{3,}|~{3,})/.exec(line);
        if (fenceMatch) {
            const indent = fenceMatch[1].length;
            const fence = fenceMatch[2];
            const closeRegex = new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`);
            const codeLines = [];
            let j = i + 1;
            for (; j < lines.length; j++) {
                if (closeRegex.test(lines[j]))
                    break;
                codeLines.push(lines[j]);
            }
            emitBlockSeparator();
            for (let k = 0; k < codeLines.length; k++) {
                const cl = codeLines[k];
                const stripped = cl.replace(new RegExp(`^\\s{0,${indent}}`), '');
                out.push(stripped);
                if (k !== codeLines.length - 1)
                    out.push('\n');
            }
            i = j + 1; // skip past closing fence (if any)
            continue;
        }
        // ---- Horizontal rule -------------------------------------------------
        if (/^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/.test(line)) {
            // HR renders nothing visible and emits NO separator of its own — the
            // next block's `emitBlockSeparator()` already inserts a single `\n\n`
            // between the two surrounding blocks. Double-emitting here would
            // produce `first\n\n\n\nsecond` for a standard `first\n\n---\n\nsecond`
            // input, which no renderer produces.
            i++;
            continue;
        }
        // ---- ATX heading -----------------------------------------------------
        const atxMatch = /^(\s{0,3})(#{1,6})(\s+)(.*?)\s*#*\s*$/.exec(line);
        if (atxMatch) {
            const text = atxMatch[4] ?? '';
            if (text) {
                emitBlockSeparator();
                renderInline(text, cfg, out);
            }
            i++;
            continue;
        }
        // ---- Setext heading (=== / ---) -------------------------------------
        if (i + 1 < lines.length) {
            const nxt = lines[i + 1];
            if (/^\s{0,3}=+\s*$/.test(nxt) || /^\s{0,3}-+\s*$/.test(nxt)) {
                emitBlockSeparator();
                renderInline(line, cfg, out);
                i += 2;
                continue;
            }
        }
        // ---- GFM table ------------------------------------------------------
        // pipe-table: header line with at least one `|`, followed by a delimiter
        // line containing only `-`, `|`, `:`, spaces.  Emit each cell's textual
        // content separated by a single space (preserves word boundaries without
        // leaking pipe characters into the visible text).
        if (cfg.gfm && i + 1 < lines.length && line.includes('|')) {
            const next = lines[i + 1];
            if (isGfmTableDelimiter(next)) {
                emitBlockSeparator();
                const rows = [line];
                let k = i + 2;
                // Collect body rows until blank or non-pipe line.
                for (; k < lines.length; k++) {
                    const r = lines[k];
                    if (r.trim() === '' || !r.includes('|'))
                        break;
                    rows.push(r);
                }
                for (let r = 0; r < rows.length; r++) {
                    const cells = splitGfmTableRow(rows[r]);
                    for (let c = 0; c < cells.length; c++) {
                        if (c > 0)
                            out.push(' ');
                        renderInline(cells[c], cfg, out);
                    }
                    if (r !== rows.length - 1)
                        out.push('\n');
                }
                i = k;
                continue;
            }
        }
        // ---- List item (bullet or ordered) ----------------------------------
        const bulletMatch = /^(\s{0,3})([-+*])\s+(.*)$/.exec(line);
        const orderedMatch = /^(\s{0,3})(\d{1,9}[.)])\s+(.*)$/.exec(line);
        if (bulletMatch || orderedMatch) {
            const m = (bulletMatch ?? orderedMatch);
            let content = m[3] ?? '';
            // GFM task list: strip the `[ ]` / `[x]` prefix when enabled.
            if (cfg.gfm) {
                const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(content);
                if (taskMatch)
                    content = taskMatch[2];
            }
            emitBlockSeparator();
            if (content)
                renderInline(content, cfg, out);
            i++;
            continue;
        }
        // ---- Blockquote ------------------------------------------------------
        const bqMatch = /^(\s{0,3})(>)(\s?)(.*)$/.exec(line);
        if (bqMatch) {
            const content = bqMatch[4] ?? '';
            emitBlockSeparator();
            if (content)
                renderInline(content, cfg, out);
            i++;
            continue;
        }
        // ---- Paragraph (collect continuation lines) -------------------------
        emitBlockSeparator();
        const paraLines = [line];
        let j = i + 1;
        while (j < lines.length) {
            const next = lines[j];
            if (next.trim() === '')
                break;
            if (/^\s{0,3}(`{3,}|~{3,})/.test(next))
                break;
            if (/^\s{0,3}#{1,6}\s+/.test(next))
                break;
            if (/^(\s{0,3})([-+*]|\d{1,9}[.)])\s+/.test(next))
                break;
            if (/^\s{0,3}>/.test(next))
                break;
            paraLines.push(next);
            j++;
        }
        for (let k = 0; k < paraLines.length; k++) {
            renderInline(paraLines[k], cfg, out);
            if (k !== paraLines.length - 1)
                out.push('\n');
        }
        i = j;
    }
}
// GFM table helpers ---------------------------------------------------------
function isGfmTableDelimiter(line) {
    // e.g. `| --- | :---: |` or `---|---`
    const trimmed = line.trim();
    if (!trimmed)
        return false;
    if (!/^[\s|:\-]+$/.test(trimmed))
        return false;
    return trimmed.includes('-');
}
function splitGfmTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|'))
        s = s.slice(1);
    if (s.endsWith('|'))
        s = s.slice(0, -1);
    // Preserve backslash-escaped pipes inside cells.
    const cells = [];
    let buf = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\' && s[i + 1] === '|') {
            buf += '|';
            i++;
            continue;
        }
        if (c === '|') {
            cells.push(buf.trim());
            buf = '';
            continue;
        }
        buf += c;
    }
    if (buf.length > 0 || cells.length > 0)
        cells.push(buf.trim());
    return cells;
}
// ---------------------------------------------------------------------------
// Inline tokenizer
// ---------------------------------------------------------------------------
/**
 * Render an inline span, stripping markdown syntax and applying typographer
 * substitutions when enabled.  Results are pushed onto `out` as individual
 * pieces — the caller joins them into the final visibleText string.
 */
function renderInline(text, cfg, out) {
    const n = text.length;
    let i = 0;
    while (i < n) {
        const c = text[i];
        // Escape sequence --------------------------------------------------
        if (c === '\\' && i + 1 < n) {
            const next = text[i + 1];
            if (/[!-/:-@[-`{-~]/.test(next)) {
                out.push(next);
                i += 2;
                continue;
            }
        }
        // Inline code ------------------------------------------------------
        if (c === '`') {
            const runMatch = /^`+/.exec(text.slice(i));
            const run = runMatch[0];
            const closeIdx = text.indexOf(run, i + run.length);
            if (closeIdx >= 0) {
                let content = text.slice(i + run.length, closeIdx);
                if (content.length >= 2 &&
                    content.startsWith(' ') &&
                    content.endsWith(' ') &&
                    content.trim().length > 0) {
                    content = content.slice(1, -1);
                }
                out.push(content);
                i = closeIdx + run.length;
                continue;
            }
            // Unclosed — treat the backticks as literal text.
            out.push(run);
            i += run.length;
            continue;
        }
        // Image ------------------------------------------------------------
        if (c === '!' && text[i + 1] === '[') {
            const closeBracket = findMatchingBracket(text, i + 1);
            if (closeBracket >= 0 && text[closeBracket + 1] === '(') {
                const closeParen = text.indexOf(')', closeBracket + 2);
                if (closeParen >= 0) {
                    out.push(cfg.mediaPlaceholderToken || MEDIA_PLACEHOLDER);
                    i = closeParen + 1;
                    continue;
                }
            }
        }
        // Link -------------------------------------------------------------
        if (c === '[') {
            const closeBracket = findMatchingBracket(text, i);
            if (closeBracket >= 0 && text[closeBracket + 1] === '(') {
                const closeParen = text.indexOf(')', closeBracket + 2);
                if (closeParen >= 0) {
                    renderInline(text.slice(i + 1, closeBracket), cfg, out);
                    i = closeParen + 1;
                    continue;
                }
            }
        }
        // Autolink ---------------------------------------------------------
        if (c === '<') {
            const closeAngle = text.indexOf('>', i + 1);
            if (closeAngle >= 0) {
                const inner = text.slice(i + 1, closeAngle);
                if (/^(https?|mailto|ftp):/.test(inner) || /^[^\s<>@]+@[^\s<>@]+\.[^\s<>]+$/.test(inner)) {
                    out.push(inner);
                    i = closeAngle + 1;
                    continue;
                }
            }
        }
        // GFM strikethrough -----------------------------------------------
        if (cfg.gfm && c === '~' && text[i + 1] === '~') {
            const closeIdx = text.indexOf('~~', i + 2);
            if (closeIdx > i + 2) {
                renderInline(text.slice(i + 2, closeIdx), cfg, out);
                i = closeIdx + 2;
                continue;
            }
        }
        // Strong / emphasis ------------------------------------------------
        if (c === '*' || c === '_') {
            const runMatch = new RegExp(`^\\${c}{1,3}`).exec(text.slice(i));
            const run = runMatch[0];
            const closeIdx = text.indexOf(run, i + run.length);
            if (closeIdx > i + run.length) {
                renderInline(text.slice(i + run.length, closeIdx), cfg, out);
                i = closeIdx + run.length;
                continue;
            }
        }
        // Hard break (two trailing spaces + newline) -----------------------
        if (c === ' ' && cfg.breaks && i + 2 < n && text[i + 1] === ' ' && text[i + 2] === '\n') {
            out.push('\n');
            i += 3;
            continue;
        }
        // Typographer ------------------------------------------------------
        if (cfg.typographer) {
            if (c === '-' && text[i + 1] === '-' && text[i + 2] === '-') {
                out.push('\u2014'); // em dash
                i += 3;
                continue;
            }
            if (c === '-' && text[i + 1] === '-') {
                out.push('\u2013'); // en dash
                i += 2;
                continue;
            }
            if (c === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
                out.push('\u2026');
                i += 3;
                continue;
            }
            if (c === '"') {
                const closeIdx = text.indexOf('"', i + 1);
                if (closeIdx > i) {
                    out.push('\u201C');
                    renderInline(text.slice(i + 1, closeIdx), cfg, out);
                    out.push('\u201D');
                    i = closeIdx + 1;
                    continue;
                }
            }
            if (c === "'") {
                const closeIdx = text.indexOf("'", i + 1);
                if (closeIdx > i) {
                    out.push('\u2018');
                    renderInline(text.slice(i + 1, closeIdx), cfg, out);
                    out.push('\u2019');
                    i = closeIdx + 1;
                    continue;
                }
            }
        }
        // Default: emit the char verbatim.
        out.push(c);
        i += 1;
    }
}
/**
 * Find the matching `]` for an opening `[` at `text[openIdx]`, accounting for
 * nested balanced brackets.  Returns -1 if no match is found.
 */
function findMatchingBracket(text, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '[')
            depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    return -1;
}
//# sourceMappingURL=markdown-visible-text.js.map