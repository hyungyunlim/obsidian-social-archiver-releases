/**
 * Template variable pattern: {{variable}} or {{object.property}}
 */
const TEMPLATE_VAR_PATTERN = /\{\{([^}]+)\}\}/g;

/**
 * Innermost conditional block pattern (content must NOT contain nested {{#if}}).
 * Supports optional {{else}} block.
 * Uses negative lookahead to match only the innermost conditional.
 */
const INNERMOST_CONDITIONAL_PATTERN = /\{\{#if\s+([^}]+)\}\}((?:(?!\{\{#if)[\s\S])*?)(?:\{\{else\}\}((?:(?!\{\{#if)[\s\S])*?))?\{\{\/if\}\}/;

/**
 * TemplateEngine - Variable substitution and conditional rendering
 * Single Responsibility: Template processing with variable interpolation and conditionals
 */
 
export class TemplateEngine {
  /**
   * Process template with data
   */
  static process(template: string, data: Record<string, unknown>): string {
    // Ensure template is a string
    if (typeof template !== 'string') {
      return String(template || '');
    }

    let result = template;

    // Process conditional blocks first (iterative inside-out for nested support)
    result = this.processConditionals(result, data);

    // Process variable substitution
    result = this.processVariables(result, data);

    // Collapse excessive blank lines (3+ consecutive newlines → 2)
    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
  }

  /**
   * Process conditional blocks iteratively from innermost outward.
   * Supports {{#if}}...{{else}}...{{/if}} and nested conditionals.
   */
  private static processConditionals(template: string, data: Record<string, unknown>): string {
    // Ensure template is a string
    if (typeof template !== 'string') {
      return String(template || '');
    }

    let result = template;
    let changed = true;

    // Iteratively process innermost conditionals until none remain
    while (changed) {
      const previous = result;
      result = result.replace(
        INNERMOST_CONDITIONAL_PATTERN,
        (_match, condition: string, ifContent: string, elseContent: string = '') => {
          const value = this.resolveValue(condition.trim(), data);

          // Truthy check
          if (value && (Array.isArray(value) ? value.length > 0 : true)) {
            return ifContent;
          }

          return elseContent;
        }
      );
      changed = result !== previous;
    }

    return result;
  }

  /**
   * Process variable substitution
   */
  private static processVariables(template: string, data: Record<string, unknown>): string {
    return template.replace(TEMPLATE_VAR_PATTERN, (_match, path: string) => {
      const value = this.resolveValue(path.trim(), data);
      return this.formatValue(value);
    });
  }

  /**
   * Resolve nested property path
   */
  private static resolveValue(path: string, data: Record<string, unknown>): unknown {
    const keys = path.split('.');
    let value: unknown = data;

    for (const key of keys) {
      if (value === null || value === undefined) {
        return '';
      }
      value = (value as Record<string, unknown>)[key];
    }

    return value;
  }

  /**
   * Format value for output
   */
  private static formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      // Format arrays as markdown list (one item per line)
      return value.map(item => `- ${String(item)}`).join('\n');
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }

    // At this point value is string | number | boolean | bigint | symbol
    return String(value as string | number | boolean | bigint | symbol);
  }
}
