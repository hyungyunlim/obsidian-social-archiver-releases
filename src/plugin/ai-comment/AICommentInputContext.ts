interface ImageTextContext {
  imageIndex: number;
  text: string;
  source?: string;
  confidence?: string;
}

const OCR_CONTEXT_TITLE = '## AI Context: Image OCR';

export function buildAICommentInputContent(markdown: string, archiveSnapshot: unknown): string {
  const imageText = readImageTextContext(archiveSnapshot);
  if (imageText.length === 0 || markdown.includes(OCR_CONTEXT_TITLE)) {
    return markdown;
  }

  const context = [
    OCR_CONTEXT_TITLE,
    '',
    'The following text was extracted from images in the archived post by OCR.',
    'Treat it as visual context from images, not as a user-authored note. OCR may contain recognition errors.',
    'If similar text also appears later in Mobile Annotations, use this section as the authoritative OCR context and avoid double-counting it.',
    '',
    ...imageText.flatMap((entry) => [
      `### Image ${entry.imageIndex + 1}`,
      entry.confidence ? `Confidence: ${entry.confidence}` : '',
      '',
      entry.text.trim(),
      '',
    ]),
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
    .trim();

  return `${context}\n\n---\n\n${markdown}`;
}

function readImageTextContext(snapshot: unknown): ImageTextContext[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const archive = (snapshot as { archive?: unknown }).archive;
  if (!archive || typeof archive !== 'object') return [];
  const imageText = (archive as { imageText?: unknown }).imageText;
  if (!Array.isArray(imageText)) return [];

  return imageText
    .map((entry) => normalizeImageTextContext(entry))
    .filter((entry): entry is ImageTextContext => entry !== null)
    .sort((a, b) => a.imageIndex - b.imageIndex)
    .slice(0, 12);
}

function normalizeImageTextContext(entry: unknown): ImageTextContext | null {
  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.imageIndex !== 'number' || !Number.isInteger(record.imageIndex) || record.imageIndex < 0) {
    return null;
  }
  if (typeof record.text !== 'string' || !record.text.trim()) return null;

  return {
    imageIndex: record.imageIndex,
    text: record.text.trim().slice(0, 3000),
    source: typeof record.source === 'string' ? record.source : 'ocr',
    confidence: typeof record.confidence === 'string' ? record.confidence : undefined,
  };
}
