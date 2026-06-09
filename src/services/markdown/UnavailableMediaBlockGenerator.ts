/**
 * Unavailable-media block generator.
 *
 * Generates an Obsidian callout for media that cannot be rendered because its
 * source is a local sentinel (a client-only `localpath:` / bare `media/...`
 * placeholder the server never preserved). Distinct from
 * `MediaPlaceholderGenerator` (which warns about expired or failed CDN media
 * and carries the original URL for re-download): an unavailable block represents
 * media that lives only on another device and has no fetchable URL to recover.
 *
 * Output format (Obsidian `[!note]` callout):
 *
 * ```markdown
 * > [!note] Media Unavailable
 * > This image is stored only on the original device.
 * > Kind: image
 * > File: media/2024-01-01/00-image.jpg
 * ```
 *
 * Single Responsibility: render the unavailable-media callout markdown.
 */

export interface UnavailableMediaInfo {
  /** Human-readable reason the media cannot be shown. */
  reason: string;
  /** Optional media kind ("image" | "video" | "audio" | "document"). */
  kind?: string;
  /** Optional stripped sentinel path / filename for context. */
  filename?: string;
}

const DEFAULT_REASON = 'This media is stored only on the original device.';

export class UnavailableMediaBlockGenerator {
  /**
   * Generate an Obsidian `[!note]` callout for an unavailable media item.
   *
   * Lines are emitted only when their data is present (reason always; kind and
   * filename when provided), so the block stays compact.
   */
  static generate(info: UnavailableMediaInfo): string {
    const reason = info.reason.trim().length > 0 ? info.reason.trim() : DEFAULT_REASON;
    const lines = ['> [!note] Media Unavailable', `> ${reason}`];

    const kind = info.kind?.trim();
    if (kind) lines.push(`> Kind: ${kind}`);

    const filename = info.filename?.trim();
    if (filename) lines.push(`> File: ${filename}`);

    return lines.join('\n');
  }
}
