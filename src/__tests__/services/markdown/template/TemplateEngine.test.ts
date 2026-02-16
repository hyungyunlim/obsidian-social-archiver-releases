import { describe, it, expect } from 'vitest';
import { TemplateEngine } from '../../../../services/markdown/template/TemplateEngine';

describe('TemplateEngine', () => {
  describe('variable substitution', () => {
    it('should replace simple variables', () => {
      const result = TemplateEngine.process('Hello {{name}}!', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should resolve nested property paths', () => {
      const result = TemplateEngine.process('By {{author.name}}', {
        author: { name: 'John' },
      });
      expect(result).toBe('By John');
    });

    it('should replace missing variables with empty string', () => {
      const result = TemplateEngine.process('Hello {{missing}}!', {});
      expect(result).toBe('Hello !');
    });

    it('should handle null values in path resolution', () => {
      const result = TemplateEngine.process('{{a.b.c}}', { a: null });
      expect(result).toBe('');
    });

    it('should format Date values as ISO string', () => {
      const date = new Date('2024-01-01T00:00:00Z');
      const result = TemplateEngine.process('{{date}}', { date });
      expect(result).toBe('2024-01-01T00:00:00.000Z');
    });

    it('should format arrays as markdown list', () => {
      const result = TemplateEngine.process('{{items}}', { items: ['a', 'b', 'c'] });
      expect(result).toBe('- a\n- b\n- c');
    });

    it('should format objects as JSON', () => {
      const result = TemplateEngine.process('{{obj}}', { obj: { key: 'val' } });
      expect(result).toContain('"key": "val"');
    });
  });

  describe('simple conditionals ({{#if}}...{{/if}})', () => {
    it('should render content when condition is truthy', () => {
      const template = '{{#if show}}visible{{/if}}';
      const result = TemplateEngine.process(template, { show: true });
      expect(result).toBe('visible');
    });

    it('should remove content when condition is falsy', () => {
      const template = '{{#if show}}visible{{/if}}';
      const result = TemplateEngine.process(template, { show: false });
      expect(result).toBe('');
    });

    it('should remove content when condition is undefined', () => {
      const template = '{{#if missing}}visible{{/if}}';
      const result = TemplateEngine.process(template, {});
      expect(result).toBe('');
    });

    it('should remove content when condition is null', () => {
      const template = '{{#if val}}visible{{/if}}';
      const result = TemplateEngine.process(template, { val: null });
      expect(result).toBe('');
    });

    it('should remove content when condition is empty string', () => {
      const template = '{{#if val}}visible{{/if}}';
      const result = TemplateEngine.process(template, { val: '' });
      expect(result).toBe('');
    });

    it('should remove content when condition is empty array', () => {
      const template = '{{#if items}}has items{{/if}}';
      const result = TemplateEngine.process(template, { items: [] });
      expect(result).toBe('');
    });

    it('should render content when condition is non-empty array', () => {
      const template = '{{#if items}}has items{{/if}}';
      const result = TemplateEngine.process(template, { items: [1] });
      expect(result).toBe('has items');
    });

    it('should resolve nested property conditions', () => {
      const template = '{{#if metadata.externalLink}}link exists{{/if}}';
      const result = TemplateEngine.process(template, {
        metadata: { externalLink: 'https://example.com' },
      });
      expect(result).toBe('link exists');
    });
  });

  describe('{{else}} blocks', () => {
    it('should render if-branch when condition is truthy', () => {
      const template = '{{#if show}}yes{{else}}no{{/if}}';
      const result = TemplateEngine.process(template, { show: true });
      expect(result).toBe('yes');
    });

    it('should render else-branch when condition is falsy', () => {
      const template = '{{#if show}}yes{{else}}no{{/if}}';
      const result = TemplateEngine.process(template, { show: false });
      expect(result).toBe('no');
    });

    it('should render else-branch when condition is undefined', () => {
      const template = '{{#if missing}}found{{else}}not found{{/if}}';
      const result = TemplateEngine.process(template, {});
      expect(result).toBe('not found');
    });

    it('should handle multiline content in if-branch', () => {
      const template = '{{#if show}}line1\nline2{{else}}fallback{{/if}}';
      const result = TemplateEngine.process(template, { show: true });
      expect(result).toBe('line1\nline2');
    });

    it('should handle multiline content in else-branch', () => {
      const template = '{{#if show}}primary{{else}}line1\nline2{{/if}}';
      const result = TemplateEngine.process(template, { show: false });
      expect(result).toBe('line1\nline2');
    });

    it('should handle variables inside if-branch', () => {
      const template = '{{#if title}}[{{title}}]({{url}}){{else}}[{{url}}]({{url}}){{/if}}';
      const result = TemplateEngine.process(template, {
        title: 'Example',
        url: 'https://example.com',
      });
      expect(result).toBe('[Example](https://example.com)');
    });

    it('should handle variables inside else-branch', () => {
      const template = '{{#if title}}[{{title}}]({{url}}){{else}}[{{url}}]({{url}}){{/if}}';
      const result = TemplateEngine.process(template, {
        title: '',
        url: 'https://example.com',
      });
      expect(result).toBe('[https://example.com](https://example.com)');
    });
  });

  describe('nested conditionals', () => {
    it('should handle nested if inside outer if (both truthy)', () => {
      const template = '{{#if outer}}A{{#if inner}}B{{/if}}C{{/if}}';
      const result = TemplateEngine.process(template, { outer: true, inner: true });
      expect(result).toBe('ABC');
    });

    it('should handle nested if inside outer if (inner falsy)', () => {
      const template = '{{#if outer}}A{{#if inner}}B{{/if}}C{{/if}}';
      const result = TemplateEngine.process(template, { outer: true, inner: false });
      expect(result).toBe('AC');
    });

    it('should handle nested if inside outer if (outer falsy)', () => {
      const template = '{{#if outer}}A{{#if inner}}B{{/if}}C{{/if}}';
      const result = TemplateEngine.process(template, { outer: false, inner: true });
      expect(result).toBe('');
    });

    it('should handle nested if with else inside outer if', () => {
      const template = '{{#if outer}}{{#if title}}[{{title}}]({{url}}){{else}}[{{url}}]({{url}}){{/if}}{{/if}}';
      const data = { outer: true, title: 'Example', url: 'https://example.com' };
      const result = TemplateEngine.process(template, data);
      expect(result).toBe('[Example](https://example.com)');
    });

    it('should handle nested if with else (else branch) inside outer if', () => {
      const template = '{{#if outer}}{{#if title}}[{{title}}]({{url}}){{else}}[{{url}}]({{url}}){{/if}}{{/if}}';
      const data = { outer: true, title: '', url: 'https://example.com' };
      const result = TemplateEngine.process(template, data);
      expect(result).toBe('[https://example.com](https://example.com)');
    });

    it('should handle outer false with nested if+else', () => {
      const template = '{{#if outer}}{{#if title}}[{{title}}]({{url}}){{else}}[link]({{url}}){{/if}}{{/if}}';
      const data = { outer: false, title: 'Example', url: 'https://example.com' };
      const result = TemplateEngine.process(template, data);
      expect(result).toBe('');
    });

    it('should handle deeply nested conditionals (3 levels)', () => {
      const template = '{{#if a}}1{{#if b}}2{{#if c}}3{{/if}}4{{/if}}5{{/if}}';
      const result = TemplateEngine.process(template, { a: true, b: true, c: true });
      expect(result).toBe('12345');
    });

    it('should handle deeply nested with middle false', () => {
      const template = '{{#if a}}1{{#if b}}2{{#if c}}3{{/if}}4{{/if}}5{{/if}}';
      const result = TemplateEngine.process(template, { a: true, b: false, c: true });
      expect(result).toBe('15');
    });
  });

  describe('Facebook external link template pattern', () => {
    it('should render external link with title (real template pattern)', () => {
      const template = `{{#if metadata.externalLink}}
> **External Link:**
> {{#if metadata.externalLinkTitle}}[{{metadata.externalLinkTitle}}]({{metadata.externalLink}}){{else}}[{{metadata.externalLink}}]({{metadata.externalLink}}){{/if}}
{{#if metadata.externalLinkDescription}}> {{metadata.externalLinkDescription}}{{/if}}
{{/if}}`;

      const data = {
        metadata: {
          externalLink: 'https://example.com/article',
          externalLinkTitle: 'Great Article',
          externalLinkDescription: 'A very good read.',
        },
      };

      const result = TemplateEngine.process(template, data);
      expect(result).toContain('[Great Article](https://example.com/article)');
      expect(result).toContain('A very good read.');
      // Should NOT contain the else-branch URL-only format
      expect(result).not.toContain('[https://example.com/article](https://example.com/article)');
    });

    it('should render external link without title (fallback)', () => {
      const template = `{{#if metadata.externalLink}}
> **External Link:**
> {{#if metadata.externalLinkTitle}}[{{metadata.externalLinkTitle}}]({{metadata.externalLink}}){{else}}[{{metadata.externalLink}}]({{metadata.externalLink}}){{/if}}
{{/if}}`;

      const data = {
        metadata: {
          externalLink: 'https://example.com/article',
          externalLinkTitle: '',
        },
      };

      const result = TemplateEngine.process(template, data);
      expect(result).toContain('[https://example.com/article](https://example.com/article)');
      // Should NOT contain the title-based link
      expect(result).not.toContain('[](');
    });

    it('should render nothing when no external link', () => {
      const template = `{{#if metadata.externalLink}}
> **External Link:**
> {{#if metadata.externalLinkTitle}}[{{metadata.externalLinkTitle}}]({{metadata.externalLink}}){{else}}[{{metadata.externalLink}}]({{metadata.externalLink}}){{/if}}
{{/if}}`;

      const data = {
        metadata: {
          externalLink: '',
        },
      };

      const result = TemplateEngine.process(template, data);
      expect(result.trim()).toBe('');
    });
  });

  describe('blank line collapsing', () => {
    it('should collapse 3+ consecutive newlines to 2', () => {
      const result = TemplateEngine.process('a\n\n\nb', {});
      expect(result).toBe('a\n\nb');
    });

    it('should collapse 5 consecutive newlines to 2', () => {
      const result = TemplateEngine.process('a\n\n\n\n\nb', {});
      expect(result).toBe('a\n\nb');
    });

    it('should preserve exactly 2 consecutive newlines', () => {
      const result = TemplateEngine.process('a\n\nb', {});
      expect(result).toBe('a\n\nb');
    });

    it('should collapse blank lines left by false conditionals', () => {
      const template = 'before\n\n{{#if show}}content{{/if}}\n\nafter';
      const result = TemplateEngine.process(template, { show: false });
      expect(result).toBe('before\n\nafter');
    });
  });

  describe('edge cases', () => {
    it('should handle non-string template input', () => {
      const result = TemplateEngine.process(null as any, {});
      expect(result).toBe('');
    });

    it('should handle undefined template input', () => {
      const result = TemplateEngine.process(undefined as any, {});
      expect(result).toBe('');
    });

    it('should handle empty string template', () => {
      const result = TemplateEngine.process('', {});
      expect(result).toBe('');
    });

    it('should handle template with no variables or conditionals', () => {
      const result = TemplateEngine.process('plain text', {});
      expect(result).toBe('plain text');
    });

    it('should handle numeric values', () => {
      const result = TemplateEngine.process('Count: {{count}}', { count: 42 });
      expect(result).toBe('Count: 42');
    });

    it('should handle boolean values', () => {
      const result = TemplateEngine.process('Active: {{active}}', { active: true });
      expect(result).toBe('Active: true');
    });
  });
});
