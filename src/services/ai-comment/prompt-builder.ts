/**
 * The one-shot AI comment prompt for every engine the plugin runs: a local
 * CLI (content inline or, when long, in a temp file the CLI reads) or the
 * user's own provider key (always inline). Pure apart from the connections
 * type, which reads a path and is CLI-only.
 */
import type { AICommentOptions, AIOutputLanguage } from '../../types/ai-comment';
import {
  AICommentError,
  DEFAULT_PROMPTS,
  getLanguageInstruction,
  getFactCheckFormatSection,
  getGlossaryFormatSection,
  getCritiqueFormatSection,
  getKeyPointsFormatSection,
  getSentimentFormatSection,
  getSummaryFormatSection,
  getConnectionsFormatSection,
  getTimestampInstruction,
} from '../../types/ai-comment';
import { buildArticleContext, buildResearchPrompt, promptToText } from '../../vendor/byok-ai-core';
import nodeRequire from '../../utils/nodeRequire';

/**
 * Build the prompt for an AI comment.
 *
 * `research` uses the shared research prompt (as one text for a CLI; BYOK
 * sends its parts separately, see ByokCommentGenerator). `chat` is a
 * conversation, never a one-shot comment.
 */
export function buildAICommentPrompt(content: string, options: AICommentOptions, contentFile?: string | null): string {
  if (options.type === 'chat') {
    throw new AICommentError('INVALID_PROMPT', 'A chat is not a one-shot comment');
  }
  if (options.type === 'research') {
    return promptToText(buildResearchPrompt({
      context: buildArticleContext({ ...options.researchContext, body: content }),
      focus: options.customPrompt,
      outputLanguage: options.outputLanguage,
      depth: 'quick',
    }));
  }

  let template: string;

  if (options.type === 'custom' && options.customPrompt) {
    // For custom prompts, wrap with content if {{content}} placeholder is not present
    // This ensures the AI always has the content to analyze
    if (options.customPrompt.includes('{{content}}')) {
      template = options.customPrompt;
    } else {
      // Append content automatically if user didn't include placeholder
      template = `${options.customPrompt}

Content:
{{content}}`;
    }
  } else if (options.type === 'custom') {
    throw new AICommentError('INVALID_PROMPT', 'Custom prompt required for custom type');
  } else {
    template = DEFAULT_PROMPTS[options.type];
  }

  const contentReference = contentFile
    ? `Read the full content from this local file: ${contentFile}`
    : content;

  // Replace placeholders
  let prompt = template.replace(/\{\{content\}\}/g, contentReference);

  if ((options.type === 'translation' || options.type === 'translate-transcript') && options.targetLanguage) {
    prompt = prompt.replace(/\{\{targetLanguage\}\}/g, options.targetLanguage);
  }

  // Get output language setting
  const outputLanguage: AIOutputLanguage = options.outputLanguage || 'auto';

  // Handle language instruction (skip for translation/translate-transcript - they have own language handling)
  if (options.type !== 'translation' && options.type !== 'translate-transcript') {
    const languageInstruction = getLanguageInstruction(outputLanguage);
    prompt = prompt.replace(/\{\{languageInstruction\}\}/g, languageInstruction);
  } else {
    // Remove the placeholder for translation types
    prompt = prompt.replace(/\{\{languageInstruction\}\}/g, '');
  }

  // Handle localized format sections based on output language
  // Fact check format section
  if (options.type === 'factcheck') {
    const factCheckFormat = getFactCheckFormatSection(outputLanguage);
    prompt = prompt.replace(/\{\{factCheckFormat\}\}/g, factCheckFormat);
  } else {
    prompt = prompt.replace(/\{\{factCheckFormat\}\}/g, '');
  }

  // Glossary format section
  if (options.type === 'glossary') {
    const glossaryFormat = getGlossaryFormatSection(outputLanguage);
    prompt = prompt.replace(/\{\{glossaryFormat\}\}/g, glossaryFormat);
  } else {
    prompt = prompt.replace(/\{\{glossaryFormat\}\}/g, '');
  }

  // Critique format section
  if (options.type === 'critique') {
    const critiqueFormat = getCritiqueFormatSection(outputLanguage);
    prompt = prompt.replace(/\{\{critiqueFormat\}\}/g, critiqueFormat);
  } else {
    prompt = prompt.replace(/\{\{critiqueFormat\}\}/g, '');
  }

  // Key points format section
  if (options.type === 'keypoints') {
    const keyPointsFormat = getKeyPointsFormatSection(outputLanguage);
    prompt = prompt.replace(/\{\{keyPointsFormat\}\}/g, keyPointsFormat);
  } else {
    prompt = prompt.replace(/\{\{keyPointsFormat\}\}/g, '');
  }

  // Sentiment format section
  if (options.type === 'sentiment') {
    const sentimentFormat = getSentimentFormatSection(outputLanguage);
    prompt = prompt.replace(/\{\{sentimentFormat\}\}/g, sentimentFormat);
  } else {
    prompt = prompt.replace(/\{\{sentimentFormat\}\}/g, '');
  }

  // Summary format section (with dynamic length based on content)
  if (options.type === 'summary') {
    const summaryFormat = getSummaryFormatSection(outputLanguage, content.length);
    prompt = prompt.replace(/\{\{summaryFormat\}\}/g, summaryFormat);
  } else {
    prompt = prompt.replace(/\{\{summaryFormat\}\}/g, '');
  }

  // Connections format section
  if (options.type === 'connections') {
    const connectionsFormat = getConnectionsFormatSection(outputLanguage);
    prompt = prompt.replace(/\{\{connectionsFormat\}\}/g, connectionsFormat);
  } else {
    prompt = prompt.replace(/\{\{connectionsFormat\}\}/g, '');
  }

  // Timestamp instruction (for podcast/video transcripts with timestamps)
  // Only added if content contains timestamps like [12:34] or [1:23:45]
  const timestampInstruction = getTimestampInstruction(content);
  prompt = prompt.replace(/\{\{timestampInstruction\}\}/g, timestampInstruction);

  // Handle vault path for connections type
  if (options.type === 'connections' && options.vaultPath) {
    prompt = prompt.replace(/\{\{vaultPath\}\}/g, options.vaultPath);
  } else {
    prompt = prompt.replace(/\{\{vaultPath\}\}/g, '');
  }

  // Handle current note path for connections type (to exclude self-reference)
  if (options.type === 'connections' && options.currentNotePath) {
    const path = nodeRequire('path') as typeof import('path');
    const noteName = path.basename(options.currentNotePath, '.md');
    prompt = prompt.replace(/\{\{currentNote\}\}/g, options.currentNotePath);
    prompt = prompt.replace(/\{\{currentNoteName\}\}/g, noteName);
  } else {
    prompt = prompt.replace(/\{\{currentNote\}\}/g, 'this note');
    prompt = prompt.replace(/\{\{currentNoteName\}\}/g, '');
  }

  return prompt;
}
