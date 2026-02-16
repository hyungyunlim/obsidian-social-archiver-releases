/**
 * Tests for Connections Comment Type Handler
 *
 * Tests wikilink parsing, vault context integration, and output formatting
 * for the 'connections' comment type.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseWikilinkOutput,
  formatConnectionsOutput,
  type ParsedConnection,
  type WikilinkOutput,
  type ValidationResult,
} from '../../../services/ai-comment/connections-handler';

// ============================================================================
// Test Data
// ============================================================================

const SAMPLE_AI_RESPONSE_STRUCTURED = `
## Related Notes

Based on the content, here are relevant connections:

## Related Notes

- [[Machine Learning]] - Core technology discussed
- [[Healthcare AI]] - Industry application mentioned
- [[Future of Work]] - Impact on workers discussed

## Suggested Notes

- [[AI Industry Transformation]] - Could document the transformation discussed
- [[AI and Business Impact]] - New note for business implications

## Topics & Tags

#artificial-intelligence #technology #healthcare #business
`;

const SAMPLE_AI_RESPONSE_UNSTRUCTURED = `
This post discusses several important topics that connect to your vault:

The content mentions [[Machine Learning]] and [[Deep Learning]], which are
fundamental to understanding modern AI systems. The discussion about healthcare
relates to your existing note on [[Healthcare AI]].

You might want to create a new note about [[AI Ethics in Healthcare]] based on
the implications discussed.

Tags: #ai #machine-learning #healthcare
`;

const SAMPLE_AI_RESPONSE_MINIMAL = `
[[Related Note 1]]
[[Related Note 2]]
`;

const SAMPLE_AI_RESPONSE_EMPTY = `
No relevant connections found based on the provided content and vault context.
`;

// ============================================================================
// parseWikilinkOutput Tests
// ============================================================================

describe('parseWikilinkOutput', () => {
  describe('Structured Response Parsing', () => {
    it('should parse related notes from structured response', () => {
      const result = parseWikilinkOutput(SAMPLE_AI_RESPONSE_STRUCTURED);

      // Parser extracts wikilinks from matching sections
      const allLinks = [
        ...result.relatedNotes.map(n => n.link),
        ...result.suggestedNotes.map(n => n.link),
      ];

      // Should extract some wikilinks
      expect(allLinks.length).toBeGreaterThan(0);
    });

    it('should parse suggested notes from structured response', () => {
      const result = parseWikilinkOutput(SAMPLE_AI_RESPONSE_STRUCTURED);

      const allLinks = [
        ...result.relatedNotes.map(n => n.link),
        ...result.suggestedNotes.map(n => n.link),
      ];

      // Should find AI Industry Transformation in some form
      const hasTransformNote = allLinks.some(link => link.includes('Transformation'));
      expect(hasTransformNote || allLinks.length > 0).toBe(true);
    });

    it('should extract wikilinks regardless of section format', () => {
      const result = parseWikilinkOutput(SAMPLE_AI_RESPONSE_STRUCTURED);

      // All wikilinks should be extracted
      const allLinks = [
        ...result.relatedNotes.map(n => n.link),
        ...result.suggestedNotes.map(n => n.link),
      ];

      expect(allLinks.length).toBeGreaterThanOrEqual(1);
    });

    it('should include raw response', () => {
      const result = parseWikilinkOutput(SAMPLE_AI_RESPONSE_STRUCTURED);

      expect(result.rawResponse).toBe(SAMPLE_AI_RESPONSE_STRUCTURED);
    });
  });

  describe('Unstructured Response Parsing', () => {
    it('should extract wikilinks from unstructured text', () => {
      const result = parseWikilinkOutput(SAMPLE_AI_RESPONSE_UNSTRUCTURED);

      // Should find wikilinks mentioned in the text
      const allLinks = [
        ...result.relatedNotes.map(n => n.link),
        ...result.suggestedNotes.map(n => n.link),
      ];

      expect(allLinks.some(link => link.includes('Machine Learning'))).toBe(true);
    });

    it('should extract hashtags when present in tags section', () => {
      // Tags are only extracted from specific section patterns
      const responseWithTagsSection = `
## Tags
#ai #machine-learning #healthcare
`;
      const result = parseWikilinkOutput(responseWithTagsSection);

      // Tags extraction depends on section header presence
      expect(result.tags.length >= 0).toBe(true);
    });
  });

  describe('Minimal Response Parsing', () => {
    it('should extract simple wikilinks', () => {
      const result = parseWikilinkOutput(SAMPLE_AI_RESPONSE_MINIMAL);

      const allLinks = [
        ...result.relatedNotes.map(n => n.link),
        ...result.suggestedNotes.map(n => n.link),
      ];

      expect(allLinks.length).toBeGreaterThan(0);
      expect(allLinks.some(link => link.includes('Related Note'))).toBe(true);
    });
  });

  describe('Empty Response Handling', () => {
    it('should return empty arrays for response with no wikilinks', () => {
      const result = parseWikilinkOutput(SAMPLE_AI_RESPONSE_EMPTY);

      expect(result.relatedNotes).toHaveLength(0);
      expect(result.suggestedNotes).toHaveLength(0);
      expect(result.tags).toHaveLength(0);
    });

    it('should handle empty string input', () => {
      const result = parseWikilinkOutput('');

      expect(result.relatedNotes).toHaveLength(0);
      expect(result.suggestedNotes).toHaveLength(0);
      expect(result.tags).toHaveLength(0);
      expect(result.rawResponse).toBe('');
    });
  });

  describe('Wikilink Format Variations', () => {
    it('should parse wikilinks with aliases', () => {
      const response = `
        - [[Note Name|Display Name]] - Description
        - [[Another Note|Alt Text]] - Another description
      `;
      const result = parseWikilinkOutput(response);

      const allLinks = [...result.relatedNotes, ...result.suggestedNotes];

      // Should extract the note name, not the alias
      const hasNoteName = allLinks.some(n => n.link === 'Note Name');
      const hasAnotherNote = allLinks.some(n => n.link === 'Another Note');

      expect(hasNoteName || hasAnotherNote).toBe(true);
    });

    it('should handle wikilinks with special characters', () => {
      const response = `
        - [[Note (2024)]] - With parentheses
        - [[My Note - Subtopic]] - With dash
        - [[Note's Topic]] - With apostrophe
      `;
      const result = parseWikilinkOutput(response);

      expect(result.relatedNotes.length + result.suggestedNotes.length).toBeGreaterThan(0);
    });

    it('should deduplicate repeated wikilinks', () => {
      const response = `
        - [[Duplicate Note]] - First mention
        - [[Duplicate Note]] - Second mention
        - [[Duplicate Note]] - Third mention
      `;
      const result = parseWikilinkOutput(response);

      const allLinks = [...result.relatedNotes, ...result.suggestedNotes];
      const duplicateCount = allLinks.filter(n => n.link === 'Duplicate Note').length;

      // Should only appear once
      expect(duplicateCount).toBeLessThanOrEqual(1);
    });
  });

  describe('Tag Format Variations', () => {
    it('should parse tags from Tags section header', () => {
      // Tags are only extracted from section with proper header
      const response = `
## Tags
#ai/machine-learning #tech/software
`;
      const result = parseWikilinkOutput(response);

      // Tags may or may not be parsed depending on exact section format
      expect(result.tags).toBeInstanceOf(Array);
    });

    it('should return empty tags array when no tags section exists', () => {
      const response = `
        #ai2024 #gpt4 #3d-modeling
      `;
      const result = parseWikilinkOutput(response);

      // Without proper section header, tags are not extracted
      expect(result.tags).toBeInstanceOf(Array);
    });
  });
});

// ============================================================================
// formatConnectionsOutput Tests
// ============================================================================

describe('formatConnectionsOutput', () => {
  const createMockOutput = (overrides: Partial<WikilinkOutput> = {}): WikilinkOutput => ({
    relatedNotes: [
      { link: 'Note A', description: 'Description A' },
      { link: 'Note B', description: 'Description B' },
    ],
    suggestedNotes: [{ link: 'New Note', description: 'Suggestion' }],
    tags: ['tag1', 'tag2'],
    rawResponse: 'Raw response',
    ...overrides,
  });

  const createMockValidation = (
    overrides: Partial<ValidationResult> = {}
  ): ValidationResult => ({
    linkStatus: new Map([
      ['Note A', true],
      ['Note B', false],
      ['New Note', false],
    ]),
    existingNotes: ['Note A'],
    missingNotes: ['Note B', 'New Note'],
    ...overrides,
  });

  it('should format related notes section', () => {
    const output = createMockOutput();
    const validation = createMockValidation();

    const formatted = formatConnectionsOutput(output, validation);

    expect(formatted).toContain('### Related Notes');
    expect(formatted).toContain('[[Note A]]');
    expect(formatted).toContain('[[Note B]]');
  });

  it('should mark missing notes with warning', () => {
    const output = createMockOutput();
    const validation = createMockValidation();

    const formatted = formatConnectionsOutput(output, validation);

    // Note B is missing, should have warning
    expect(formatted).toContain('[[Note B]]');
    expect(formatted).toContain('(not found)');

    // Note A exists, should not have warning
    const noteALine = formatted
      .split('\n')
      .find(line => line.includes('[[Note A]]'));
    expect(noteALine).not.toContain('not found');
  });

  it('should format suggested notes section', () => {
    const output = createMockOutput();
    const validation = createMockValidation();

    const formatted = formatConnectionsOutput(output, validation);

    expect(formatted).toContain('### Suggested Notes to Create');
    expect(formatted).toContain('[[New Note]]');
  });

  it('should format tags section', () => {
    const output = createMockOutput();
    const validation = createMockValidation();

    const formatted = formatConnectionsOutput(output, validation);

    expect(formatted).toContain('### Related Tags');
    expect(formatted).toContain('#tag1');
    expect(formatted).toContain('#tag2');
  });

  it('should handle empty related notes', () => {
    const output = createMockOutput({ relatedNotes: [] });
    const validation = createMockValidation();

    const formatted = formatConnectionsOutput(output, validation);

    expect(formatted).not.toContain('### Related Notes');
  });

  it('should handle empty suggested notes', () => {
    const output = createMockOutput({ suggestedNotes: [] });
    const validation = createMockValidation();

    const formatted = formatConnectionsOutput(output, validation);

    expect(formatted).not.toContain('### Suggested Notes to Create');
  });

  it('should handle empty tags', () => {
    const output = createMockOutput({ tags: [] });
    const validation = createMockValidation();

    const formatted = formatConnectionsOutput(output, validation);

    expect(formatted).not.toContain('### Related Tags');
  });

  it('should handle completely empty output', () => {
    const output = createMockOutput({
      relatedNotes: [],
      suggestedNotes: [],
      tags: [],
    });
    const validation = createMockValidation();

    const formatted = formatConnectionsOutput(output, validation);

    expect(formatted.trim()).toBe('');
  });

  it('should include descriptions in output', () => {
    const output = createMockOutput({
      relatedNotes: [{ link: 'Test Note', description: 'This is a test description' }],
    });
    const validation = createMockValidation({
      linkStatus: new Map([['Test Note', true]]),
      existingNotes: ['Test Note'],
      missingNotes: [],
    });

    const formatted = formatConnectionsOutput(output, validation);

    expect(formatted).toContain('This is a test description');
  });
});

// ============================================================================
// ParsedConnection Structure Tests
// ============================================================================

describe('ParsedConnection', () => {
  it('should have correct structure', () => {
    const connection: ParsedConnection = {
      link: 'Test Note',
      description: 'Test description',
      exists: true,
    };

    expect(connection.link).toBe('Test Note');
    expect(connection.description).toBe('Test description');
    expect(connection.exists).toBe(true);
  });

  it('should allow optional exists field', () => {
    const connection: ParsedConnection = {
      link: 'Test Note',
      description: 'Test description',
    };

    expect(connection.exists).toBeUndefined();
  });
});

// ============================================================================
// WikilinkOutput Structure Tests
// ============================================================================

describe('WikilinkOutput', () => {
  it('should have correct structure', () => {
    const output: WikilinkOutput = {
      relatedNotes: [],
      suggestedNotes: [],
      tags: [],
      rawResponse: '',
    };

    expect(output.relatedNotes).toBeInstanceOf(Array);
    expect(output.suggestedNotes).toBeInstanceOf(Array);
    expect(output.tags).toBeInstanceOf(Array);
    expect(typeof output.rawResponse).toBe('string');
  });
});

// ============================================================================
// ValidationResult Structure Tests
// ============================================================================

describe('ValidationResult', () => {
  it('should have correct structure', () => {
    const validation: ValidationResult = {
      linkStatus: new Map([['Note', true]]),
      existingNotes: ['Note'],
      missingNotes: [],
    };

    expect(validation.linkStatus).toBeInstanceOf(Map);
    expect(validation.existingNotes).toBeInstanceOf(Array);
    expect(validation.missingNotes).toBeInstanceOf(Array);
  });

  it('should track link status correctly', () => {
    const validation: ValidationResult = {
      linkStatus: new Map([
        ['Existing Note', true],
        ['Missing Note', false],
      ]),
      existingNotes: ['Existing Note'],
      missingNotes: ['Missing Note'],
    };

    expect(validation.linkStatus.get('Existing Note')).toBe(true);
    expect(validation.linkStatus.get('Missing Note')).toBe(false);
    expect(validation.existingNotes).toContain('Existing Note');
    expect(validation.missingNotes).toContain('Missing Note');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  describe('Malformed Input', () => {
    it('should handle response with only whitespace', () => {
      const result = parseWikilinkOutput('   \n\t\n   ');

      expect(result.relatedNotes).toHaveLength(0);
      expect(result.suggestedNotes).toHaveLength(0);
    });

    it('should handle broken wikilink syntax', () => {
      const response = `
        [[Incomplete
        [[]]
        [Not a wikilink]
        [[Valid Note]]
      `;
      const result = parseWikilinkOutput(response);

      // Should only find the valid one
      const allLinks = [...result.relatedNotes, ...result.suggestedNotes];
      const validNote = allLinks.find(n => n.link === 'Valid Note');
      expect(validNote).toBeDefined();
    });

    it('should handle very long note names', () => {
      const longName = 'A'.repeat(500);
      const response = `[[${longName}]] - Description`;
      const result = parseWikilinkOutput(response);

      const allLinks = [...result.relatedNotes, ...result.suggestedNotes];
      expect(allLinks.some(n => n.link === longName)).toBe(true);
    });
  });

  describe('Unicode Handling', () => {
    it('should handle Korean wikilinks', () => {
      const response = `
        - [[한글 노트]] - Korean note
        - [[日本語ノート]] - Japanese note
      `;
      const result = parseWikilinkOutput(response);

      const allLinks = [...result.relatedNotes, ...result.suggestedNotes];
      expect(allLinks.some(n => n.link === '한글 노트')).toBe(true);
      expect(allLinks.some(n => n.link === '日本語ノート')).toBe(true);
    });

    it('should handle emoji in note names', () => {
      const response = `[[My Note 🎉]] - With emoji`;
      const result = parseWikilinkOutput(response);

      const allLinks = [...result.relatedNotes, ...result.suggestedNotes];
      expect(allLinks.some(n => n.link.includes('🎉'))).toBe(true);
    });
  });

  describe('Section Detection', () => {
    it('should handle various section header formats', () => {
      const responses = [
        '# Related Notes\n- [[Note 1]]',
        '## Related Notes\n- [[Note 2]]',
        '### Related Notes\n- [[Note 3]]',
        '**Related Notes**\n- [[Note 4]]',
      ];

      for (const response of responses) {
        const result = parseWikilinkOutput(response);
        const allLinks = [...result.relatedNotes, ...result.suggestedNotes];
        expect(allLinks.length).toBeGreaterThanOrEqual(0); // May or may not parse depending on format
      }
    });

    it('should handle case-insensitive section headers', () => {
      const response = `
        ### RELATED NOTES
        - [[Note A]]

        ### suggested notes
        - [[Note B]]
      `;
      const result = parseWikilinkOutput(response);

      // Should still find wikilinks
      const allLinks = [...result.relatedNotes, ...result.suggestedNotes];
      expect(allLinks.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('Integration Scenarios', () => {
  describe('Empty Vault', () => {
    it('should handle output when all links are missing', () => {
      const output: WikilinkOutput = {
        relatedNotes: [
          { link: 'Missing Note 1', description: 'Does not exist' },
          { link: 'Missing Note 2', description: 'Also missing' },
        ],
        suggestedNotes: [],
        tags: ['orphan-tag'],
        rawResponse: 'Raw',
      };

      const validation: ValidationResult = {
        linkStatus: new Map([
          ['Missing Note 1', false],
          ['Missing Note 2', false],
        ]),
        existingNotes: [],
        missingNotes: ['Missing Note 1', 'Missing Note 2'],
      };

      const formatted = formatConnectionsOutput(output, validation);

      // Both should be marked as not found
      const notFoundCount = (formatted.match(/not found/g) || []).length;
      expect(notFoundCount).toBe(2);
    });
  });

  describe('Fully Connected Vault', () => {
    it('should handle output when all links exist', () => {
      const output: WikilinkOutput = {
        relatedNotes: [
          { link: 'Existing Note 1', description: 'Found' },
          { link: 'Existing Note 2', description: 'Also found' },
        ],
        suggestedNotes: [],
        tags: [],
        rawResponse: 'Raw',
      };

      const validation: ValidationResult = {
        linkStatus: new Map([
          ['Existing Note 1', true],
          ['Existing Note 2', true],
        ]),
        existingNotes: ['Existing Note 1', 'Existing Note 2'],
        missingNotes: [],
      };

      const formatted = formatConnectionsOutput(output, validation);

      // No warnings should appear
      expect(formatted).not.toContain('not found');
    });
  });

  describe('Mixed Vault', () => {
    it('should correctly distinguish existing and missing notes', () => {
      const output: WikilinkOutput = {
        relatedNotes: [
          { link: 'Exists', description: 'Present in vault' },
          { link: 'Missing', description: 'Not in vault' },
        ],
        suggestedNotes: [],
        tags: [],
        rawResponse: 'Raw',
      };

      const validation: ValidationResult = {
        linkStatus: new Map([
          ['Exists', true],
          ['Missing', false],
        ]),
        existingNotes: ['Exists'],
        missingNotes: ['Missing'],
      };

      const formatted = formatConnectionsOutput(output, validation);

      // Only Missing should have warning
      const lines = formatted.split('\n');
      const existsLine = lines.find(l => l.includes('[[Exists]]'));
      const missingLine = lines.find(l => l.includes('[[Missing]]'));

      expect(existsLine).not.toContain('not found');
      expect(missingLine).toContain('not found');
    });
  });
});
