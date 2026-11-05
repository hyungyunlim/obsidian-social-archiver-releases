import { describe, expect, it } from 'vitest';
import { paintAIMentions } from '../../utils/paintAIMentions';

const text = (value: string): Text => activeDocument.createTextNode(value);

describe('paintAIMentions', () => {
  it('wraps each AI mention in the note, keeping the text around it', () => {
    const el = activeWindow.createDiv();
    el.appendChild(text('Is this true @Claude? Ask @GPT too'));
    paintAIMentions(el);
    expect([...el.querySelectorAll('.sa-ai-mention')].map((span) => span.textContent)).toEqual(['@Claude', '@GPT']);
    expect(el.textContent).toBe('Is this true @Claude? Ask @GPT too');
  });

  it('leaves links, other @handles and text without mentions as they are', () => {
    const el = activeWindow.createDiv();
    el.createEl('a', { href: 'https://x.com/Claude' }).appendChild(text('@Claude'));
    el.appendChild(text(' cc @ada '));
    el.createSpan({ text: 'plain' });
    const before = el.innerHTML;
    paintAIMentions(el);
    expect(el.querySelector('.sa-ai-mention')).toBeNull();
    expect(el.innerHTML).toBe(before);
  });

  it('reaches into nested elements', () => {
    const el = activeWindow.createDiv();
    const span = el.createSpan();
    span.createEl('strong').appendChild(text('@Gemini'));
    span.appendChild(text(' what now?'));
    paintAIMentions(el);
    expect(el.querySelector('strong .sa-ai-mention')?.textContent).toBe('@Gemini');
  });
});
