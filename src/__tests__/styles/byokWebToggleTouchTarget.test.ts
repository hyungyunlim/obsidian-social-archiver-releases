import { describe, expect, it } from 'vitest';

/**
 * The "search the web" controls (chat composer's web chip and send, custom AI
 * comment option) reach 44px on coarse pointers: Obsidian mobile and touch
 * screens (iOS HIG).
 * jsdom applies no media queries (and vitest blanks CSS imports, `?raw`
 * included), so this reads the stylesheets from disk.
 */

type Rule = { selector: string; body: string };

function rules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' }));
}

/** The rules inside a component stylesheet's `@media (pointer: coarse)` blocks. */
async function coarseRules(file: string): Promise<Rule[]> {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(`${process.cwd()}/src/styles/components/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const coarse: Rule[] = [];
  for (let at = css.indexOf('@media (pointer: coarse)'); at !== -1; at = css.indexOf('@media (pointer: coarse)', at + 1)) {
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) {
        coarse.push(...rules(css.slice(open + 1, i)));
        break;
      }
    }
  }
  return coarse;
}

/** The declarations of every rule naming `selector`, alone or in a selector list. */
function declarations(list: Rule[], selector: string): string {
  return list
    .filter((rule) => rule.selector.split(',').some((part) => part.trim() === selector))
    .map((rule) => rule.body)
    .join(';');
}

describe('web search controls are touch-sized', () => {
  it('makes the chat web chip 44px tall and send 44px square on coarse pointers', async () => {
    const coarse = await coarseRules('ai-conversation.css');
    expect(declarations(coarse, '.sa-ai-chat-composer .sa-ai-chat-web')).toMatch(/min-height:\s*44px/);
    const send = declarations(coarse, '.sa-ai-chat-composer .sa-ai-chat-send');
    expect(send).toMatch(/(^|[\s;])width:\s*44px/);
    expect(send).toMatch(/(^|[\s;])height:\s*44px/);
  });

  it('makes the custom comment option 44px tall on coarse pointers', async () => {
    const coarse = await coarseRules('content-renderers.css');
    expect(declarations(coarse, '.acb-web-option')).toMatch(/min-height:\s*44px/);
  });
});
