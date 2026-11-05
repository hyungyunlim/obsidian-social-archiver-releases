/**
 * AI mentions (`@Claude`) in a rendered note, wrapped in `span.sa-ai-mention`
 * so they read as mentions, the way the apps' note composers paint them.
 * Runs on what the note renderer produced; text inside links stays as it is.
 */
import { findAIMentions } from '../vendor/byok-ai-core';

export function paintAIMentions(root: HTMLElement): void {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      paintText(node as Text);
    } else if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName !== 'A') {
      paintAIMentions(node as HTMLElement);
    }
  }
}

function paintText(node: Text): void {
  const text = node.data;
  const parent = node.parentNode;
  const mentions = findAIMentions(text);
  if (!parent || mentions.length === 0) return;
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start > cursor) parent.insertBefore(activeDocument.createTextNode(text.slice(cursor, mention.start)), node);
    parent.insertBefore(activeWindow.createSpan({ cls: 'sa-ai-mention', text: text.slice(mention.start, mention.end) }), node);
    cursor = mention.end;
  }
  if (cursor < text.length) parent.insertBefore(activeDocument.createTextNode(text.slice(cursor)), node);
  parent.removeChild(node);
}
