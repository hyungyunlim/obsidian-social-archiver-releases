/**
 * AI Comment Types and Interfaces
 *
 * Types for AI-powered comment generation feature using local CLI tools.
 */

import type { AICli } from '../utils/ai-cli';
import type { Platform } from '../shared/platforms/types';

// Re-export AICli for convenience
export type { AICli } from '../utils/ai-cli';

/**
 * Types of AI-generated comments
 */
export type AICommentType =
  | 'summary' // Concise summary of the content
  | 'factcheck' // Fact-checking analysis
  | 'critique' // Critical analysis
  | 'keypoints' // Key points extraction
  | 'sentiment' // Sentiment analysis
  | 'connections' // Connections to other notes (vault context)
  | 'translation' // Translation to another language
  | 'translate-transcript' // Translate transcript to another language (preserving timestamps)
  | 'glossary' // Explain technical/specialized terms
  | 'reformat' // Reformat markdown layout without changing content
  | 'custom'; // User-defined prompt

/**
 * AI comment metadata stored in YAML frontmatter
 */
export interface AICommentMeta {
  /** Unique identifier (e.g., 'claude-summary-20241214T103000Z') */
  id: string;
  /** CLI tool used for generation */
  cli: AICli;
  /** Model selected for generation, if explicitly requested */
  model?: string;
  /** Type of comment generated */
  type: AICommentType;
  /** ISO timestamp of generation */
  generatedAt: string;
  /** Processing time in milliseconds */
  processingTime: number;
  /** Hash of content used (for change detection) */
  contentHash: string;
  /** Custom prompt used (if type is 'custom') */
  customPrompt?: string;
  /** Source language ISO code (for 'translate-transcript' type) */
  sourceLanguage?: string;
  /** Target language ISO code (for 'translate-transcript' type) */
  targetLanguage?: string;
}

/**
 * Custom prompt configuration
 */
export interface CustomPrompt {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** The prompt template (use {{content}} for content placeholder) */
  template: string;
  /** Optional description */
  description?: string;
  /** When the prompt was created */
  createdAt: string;
}

/**
 * Platform visibility settings for AI comments
 */
export interface PlatformVisibility {
  /** Enable for social media platforms */
  socialMedia: boolean;
  /** Enable for blog/news platforms */
  blogNews: boolean;
  /** Enable for video/audio platforms */
  videoAudio: boolean;
  /** Platforms to exclude even if category is enabled */
  excludedPlatforms: Platform[];
}

/**
 * Vault context settings for AI comments
 */
export interface VaultContextSettings {
  /** Enable vault context for connections */
  enabled: boolean;
  /** Paths to exclude from context */
  excludePaths: string[];
  /** Use smart filtering to select relevant notes */
  smartFiltering: boolean;
  /** Maximum number of context notes */
  maxContextNotes?: number;
}

/**
 * Output language options for AI comments
 * - 'auto': Detect content language and respond in the same language
 * - 'en', 'ko', 'ja', etc.: Always respond in the specified language
 */
export type AIOutputLanguage = 'auto' | 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'ar' | 'hi';

/**
 * Display names for output languages
 */
export const OUTPUT_LANGUAGE_NAMES: Record<AIOutputLanguage, string> = {
  auto: 'Auto (match content language)',
  en: 'English',
  ko: '한국어 (Korean)',
  ja: '日本語 (Japanese)',
  zh: '中文 (Chinese)',
  es: 'Español (Spanish)',
  fr: 'Français (French)',
  de: 'Deutsch (German)',
  pt: 'Português (Portuguese)',
  ru: 'Русский (Russian)',
  ar: 'العربية (Arabic)',
  hi: 'हिन्दी (Hindi)',
};

/**
 * Full language names for prompt instructions
 */
const LANGUAGE_FULL_NAMES: Record<Exclude<AIOutputLanguage, 'auto'>, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  zh: 'Chinese',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
};

/**
 * Format labels for structured AI outputs (fact check, glossary, etc.)
 * These labels should be used in the AI's response format
 */
export interface FormatLabels {
  // Fact Check labels
  factCheckResults: string;
  claim: string;
  verdict: string;
  verdictVerified: string;
  verdictPartiallyTrue: string;
  verdictFalse: string;
  verdictUnverifiable: string;
  source: string;
  overallAssessment: string;
  details: string;

  // Glossary labels
  term: string;
  definition: string;

  // Key Points labels
  keyPoints: string;

  // Sentiment labels
  sentimentAnalysis: string;
  overallTone: string;

  // Critique labels
  criticalAnalysis: string;
  strengths: string;
  weaknesses: string;

  // Summary labels
  summary: string;

  // Connections labels
  noteConnections: string;
  relatedNotes: string;
}

/**
 * Format labels translations for each supported language
 */
export const FORMAT_LABELS: Record<Exclude<AIOutputLanguage, 'auto'>, FormatLabels> = {
  en: {
    factCheckResults: 'Fact Check Results',
    claim: 'Claim',
    verdict: 'Verdict',
    verdictVerified: 'Verified',
    verdictPartiallyTrue: 'Partially True',
    verdictFalse: 'False',
    verdictUnverifiable: 'Unverifiable',
    source: 'Source',
    overallAssessment: 'Overall Assessment',
    details: 'Details',
    term: 'Term',
    definition: 'Definition',
    keyPoints: 'Key Points',
    sentimentAnalysis: 'Sentiment Analysis',
    overallTone: 'Overall Tone',
    criticalAnalysis: 'Critical Analysis',
    strengths: 'Strengths',
    weaknesses: 'Weaknesses',
    summary: 'Summary',
    noteConnections: 'Note Connections',
    relatedNotes: 'Related Notes',
  },
  ko: {
    factCheckResults: '팩트 체크 결과',
    claim: '주장',
    verdict: '판정',
    verdictVerified: '사실',
    verdictPartiallyTrue: '부분적 사실',
    verdictFalse: '거짓',
    verdictUnverifiable: '검증 불가',
    source: '출처',
    overallAssessment: '종합 평가',
    details: '상세',
    term: '용어',
    definition: '정의',
    keyPoints: '핵심 포인트',
    sentimentAnalysis: '감정 분석',
    overallTone: '전체적 어조',
    criticalAnalysis: '비판적 분석',
    strengths: '강점',
    weaknesses: '약점',
    summary: '요약',
    noteConnections: '노트 연결',
    relatedNotes: '관련 노트',
  },
  ja: {
    factCheckResults: 'ファクトチェック結果',
    claim: '主張',
    verdict: '判定',
    verdictVerified: '事実',
    verdictPartiallyTrue: '一部事実',
    verdictFalse: '虚偽',
    verdictUnverifiable: '検証不可',
    source: '出典',
    overallAssessment: '総合評価',
    details: '詳細',
    term: '用語',
    definition: '定義',
    keyPoints: 'キーポイント',
    sentimentAnalysis: '感情分析',
    overallTone: '全体的なトーン',
    criticalAnalysis: '批判的分析',
    strengths: '強み',
    weaknesses: '弱み',
    summary: '要約',
    noteConnections: 'ノート連携',
    relatedNotes: '関連ノート',
  },
  zh: {
    factCheckResults: '事实核查结果',
    claim: '声明',
    verdict: '判定',
    verdictVerified: '属实',
    verdictPartiallyTrue: '部分属实',
    verdictFalse: '不实',
    verdictUnverifiable: '无法核实',
    source: '来源',
    overallAssessment: '综合评估',
    details: '详情',
    term: '术语',
    definition: '定义',
    keyPoints: '要点',
    sentimentAnalysis: '情感分析',
    overallTone: '整体基调',
    criticalAnalysis: '批判性分析',
    strengths: '优点',
    weaknesses: '缺点',
    summary: '摘要',
    noteConnections: '笔记关联',
    relatedNotes: '相关笔记',
  },
  es: {
    factCheckResults: 'Resultados de Verificación',
    claim: 'Afirmación',
    verdict: 'Veredicto',
    verdictVerified: 'Verificado',
    verdictPartiallyTrue: 'Parcialmente Verdadero',
    verdictFalse: 'Falso',
    verdictUnverifiable: 'No Verificable',
    source: 'Fuente',
    overallAssessment: 'Evaluación General',
    details: 'Detalles',
    term: 'Término',
    definition: 'Definición',
    keyPoints: 'Puntos Clave',
    sentimentAnalysis: 'Análisis de Sentimiento',
    overallTone: 'Tono General',
    criticalAnalysis: 'Análisis Crítico',
    strengths: 'Fortalezas',
    weaknesses: 'Debilidades',
    summary: 'Resumen',
    noteConnections: 'Conexiones de Notas',
    relatedNotes: 'Notas Relacionadas',
  },
  fr: {
    factCheckResults: 'Résultats de Vérification',
    claim: 'Affirmation',
    verdict: 'Verdict',
    verdictVerified: 'Vérifié',
    verdictPartiallyTrue: 'Partiellement Vrai',
    verdictFalse: 'Faux',
    verdictUnverifiable: 'Non Vérifiable',
    source: 'Source',
    overallAssessment: 'Évaluation Globale',
    details: 'Détails',
    term: 'Terme',
    definition: 'Définition',
    keyPoints: 'Points Clés',
    sentimentAnalysis: 'Analyse de Sentiment',
    overallTone: 'Ton Général',
    criticalAnalysis: 'Analyse Critique',
    strengths: 'Points Forts',
    weaknesses: 'Points Faibles',
    summary: 'Résumé',
    noteConnections: 'Connexions de Notes',
    relatedNotes: 'Notes Associées',
  },
  de: {
    factCheckResults: 'Faktencheck-Ergebnisse',
    claim: 'Behauptung',
    verdict: 'Urteil',
    verdictVerified: 'Verifiziert',
    verdictPartiallyTrue: 'Teilweise Wahr',
    verdictFalse: 'Falsch',
    verdictUnverifiable: 'Nicht Verifizierbar',
    source: 'Quelle',
    overallAssessment: 'Gesamtbewertung',
    details: 'Details',
    term: 'Begriff',
    definition: 'Definition',
    keyPoints: 'Kernpunkte',
    sentimentAnalysis: 'Stimmungsanalyse',
    overallTone: 'Allgemeiner Ton',
    criticalAnalysis: 'Kritische Analyse',
    strengths: 'Stärken',
    weaknesses: 'Schwächen',
    summary: 'Zusammenfassung',
    noteConnections: 'Notizverknüpfungen',
    relatedNotes: 'Verwandte Notizen',
  },
  pt: {
    factCheckResults: 'Resultados da Verificação',
    claim: 'Alegação',
    verdict: 'Veredito',
    verdictVerified: 'Verificado',
    verdictPartiallyTrue: 'Parcialmente Verdadeiro',
    verdictFalse: 'Falso',
    verdictUnverifiable: 'Não Verificável',
    source: 'Fonte',
    overallAssessment: 'Avaliação Geral',
    details: 'Detalhes',
    term: 'Termo',
    definition: 'Definição',
    keyPoints: 'Pontos-Chave',
    sentimentAnalysis: 'Análise de Sentimento',
    overallTone: 'Tom Geral',
    criticalAnalysis: 'Análise Crítica',
    strengths: 'Pontos Fortes',
    weaknesses: 'Pontos Fracos',
    summary: 'Resumo',
    noteConnections: 'Conexões de Notas',
    relatedNotes: 'Notas Relacionadas',
  },
  ru: {
    factCheckResults: 'Результаты проверки фактов',
    claim: 'Утверждение',
    verdict: 'Вердикт',
    verdictVerified: 'Подтверждено',
    verdictPartiallyTrue: 'Частично верно',
    verdictFalse: 'Ложь',
    verdictUnverifiable: 'Не проверяемо',
    source: 'Источник',
    overallAssessment: 'Общая оценка',
    details: 'Детали',
    term: 'Термин',
    definition: 'Определение',
    keyPoints: 'Ключевые моменты',
    sentimentAnalysis: 'Анализ тональности',
    overallTone: 'Общий тон',
    criticalAnalysis: 'Критический анализ',
    strengths: 'Сильные стороны',
    weaknesses: 'Слабые стороны',
    summary: 'Резюме',
    noteConnections: 'Связи заметок',
    relatedNotes: 'Связанные заметки',
  },
  ar: {
    factCheckResults: 'نتائج التحقق من الحقائق',
    claim: 'الادعاء',
    verdict: 'الحكم',
    verdictVerified: 'تم التحقق',
    verdictPartiallyTrue: 'صحيح جزئياً',
    verdictFalse: 'كاذب',
    verdictUnverifiable: 'غير قابل للتحقق',
    source: 'المصدر',
    overallAssessment: 'التقييم العام',
    details: 'التفاصيل',
    term: 'المصطلح',
    definition: 'التعريف',
    keyPoints: 'النقاط الرئيسية',
    sentimentAnalysis: 'تحليل المشاعر',
    overallTone: 'النبرة العامة',
    criticalAnalysis: 'التحليل النقدي',
    strengths: 'نقاط القوة',
    weaknesses: 'نقاط الضعف',
    summary: 'الملخص',
    noteConnections: 'روابط الملاحظات',
    relatedNotes: 'ملاحظات ذات صلة',
  },
  hi: {
    factCheckResults: 'तथ्य जांच परिणाम',
    claim: 'दावा',
    verdict: 'निर्णय',
    verdictVerified: 'सत्यापित',
    verdictPartiallyTrue: 'आंशिक रूप से सत्य',
    verdictFalse: 'झूठ',
    verdictUnverifiable: 'सत्यापन योग्य नहीं',
    source: 'स्रोत',
    overallAssessment: 'समग्र मूल्यांकन',
    details: 'विवरण',
    term: 'शब्द',
    definition: 'परिभाषा',
    keyPoints: 'मुख्य बिंदु',
    sentimentAnalysis: 'भावना विश्लेषण',
    overallTone: 'समग्र स्वर',
    criticalAnalysis: 'आलोचनात्मक विश्लेषण',
    strengths: 'शक्तियां',
    weaknesses: 'कमजोरियां',
    summary: 'सारांश',
    noteConnections: 'नोट कनेक्शन',
    relatedNotes: 'संबंधित नोट्स',
  },
};

/**
 * Get format labels for a specific language
 * @param outputLanguage - The output language setting
 * @returns Format labels in the specified language, defaults to English
 */
export function getFormatLabels(outputLanguage: AIOutputLanguage): FormatLabels {
  if (outputLanguage === 'auto') {
    // For 'auto', return English labels but AI will be instructed to translate them
    return FORMAT_LABELS.en;
  }
  return FORMAT_LABELS[outputLanguage] || FORMAT_LABELS.en;
}

/**
 * Generate language instruction for AI prompt
 * @param outputLanguage - The output language setting
 * @returns Instruction string to include in the prompt
 */
export function getLanguageInstruction(outputLanguage: AIOutputLanguage): string {
  if (outputLanguage === 'auto') {
    return `IMPORTANT: Respond in the same language as the content below. If the content is in Korean, respond in Korean. If in Japanese, respond in Japanese, etc.
ALL format labels, headers, and section titles in your response MUST also be in the same language as the content. Do NOT use English labels like "Fact Check Results", "Claim", "Verdict" etc. if the content is in another language.`;
  }

  const langName = LANGUAGE_FULL_NAMES[outputLanguage];
  const labels = FORMAT_LABELS[outputLanguage];
  return `IMPORTANT: Respond in ${langName}.
ALL format labels and headers MUST be in ${langName}. For example:
- "Fact Check Results" → "${labels.factCheckResults}"
- "Claim" → "${labels.claim}"
- "Verdict" → "${labels.verdict}"
- "Source" → "${labels.source}"
- "Overall Assessment" → "${labels.overallAssessment}"`;
}

/**
 * Generate fact check format section for a specific language
 * @param outputLanguage - The output language setting
 * @returns Format section string to include in the factcheck prompt
 */
export function getFactCheckFormatSection(outputLanguage: AIOutputLanguage): string {
  // For 'auto', provide format in English but AI will translate based on content language
  const labels = outputLanguage === 'auto' ? FORMAT_LABELS.en : FORMAT_LABELS[outputLanguage];

  return `Format:
## ${labels.factCheckResults}

**${labels.claim}:** [claim]
**${labels.verdict}:** ✅ ${labels.verdictVerified} / ⚠️ ${labels.verdictPartiallyTrue} / ❌ ${labels.verdictFalse} / ❓ ${labels.verdictUnverifiable}
**${labels.source}:** [URL]

(Repeat for up to 3 claims)

## ${labels.overallAssessment}
[1-2 sentences on content accuracy]`;
}

/**
 * Generate glossary format section for a specific language
 * @param outputLanguage - The output language setting
 * @returns Format section string to include in the glossary prompt
 */
export function getGlossaryFormatSection(outputLanguage: AIOutputLanguage): string {
  const labels = outputLanguage === 'auto' ? FORMAT_LABELS.en : FORMAT_LABELS[outputLanguage];

  return `## Output Format
**${labels.term}**
${labels.definition} (1-2 sentences). [${labels.source}](URL) if available.`;
}

/**
 * Generate critique format section for a specific language
 * @param outputLanguage - The output language setting
 * @returns Format section string to include in the critique prompt
 */
export function getCritiqueFormatSection(outputLanguage: AIOutputLanguage): string {
  const labels = outputLanguage === 'auto' ? FORMAT_LABELS.en : FORMAT_LABELS[outputLanguage];

  return `Format your response with these sections:
## ${labels.criticalAnalysis}
## ${labels.strengths}
## ${labels.weaknesses}`;
}

/**
 * Generate key points format section for a specific language
 * @param outputLanguage - The output language setting
 * @returns Format section string to include in the keypoints prompt
 */
export function getKeyPointsFormatSection(outputLanguage: AIOutputLanguage): string {
  const labels = outputLanguage === 'auto' ? FORMAT_LABELS.en : FORMAT_LABELS[outputLanguage];

  return `Format:
## ${labels.keyPoints}
- [point 1]
- [point 2]
...`;
}

/**
 * Generate sentiment format section for a specific language
 * @param outputLanguage - The output language setting
 * @returns Format section string to include in the sentiment prompt
 */
export function getSentimentFormatSection(outputLanguage: AIOutputLanguage): string {
  const labels = outputLanguage === 'auto' ? FORMAT_LABELS.en : FORMAT_LABELS[outputLanguage];

  return `Format:
## ${labels.sentimentAnalysis}
**${labels.overallTone}:** [tone description]
[detailed analysis]`;
}

/**
 * Get summary length guideline based on content length
 * Longer content (podcasts, blog posts, etc.) gets more detailed summaries
 */
export function getSummaryLengthGuideline(contentLength: number): string {
  if (contentLength < 500) {
    return '1-2 sentence';
  } else if (contentLength < 2000) {
    return '2-3 sentence';
  } else if (contentLength < 5000) {
    return '3-5 sentence';
  } else {
    // Long-form content: podcasts, blog posts, articles, etc.
    return '5-8 sentence';
  }
}

/**
 * Generate summary format section for a specific language
 * @param outputLanguage - The output language setting
 * @param contentLength - Optional content length for dynamic summary length
 * @returns Format section string to include in the summary prompt
 */
export function getSummaryFormatSection(_outputLanguage: AIOutputLanguage, contentLength?: number): string {
  const lengthGuideline = contentLength ? getSummaryLengthGuideline(contentLength) : '2-3 sentence';

  return `Format:
[${lengthGuideline} summary only]
Do not include a heading such as "## Summary" or "## 요약".`;
}

/**
 * Generate connections format section for a specific language
 * @param outputLanguage - The output language setting
 * @returns Format section string to include in the connections prompt
 */
export function getConnectionsFormatSection(outputLanguage: AIOutputLanguage): string {
  const labels = outputLanguage === 'auto' ? FORMAT_LABELS.en : FORMAT_LABELS[outputLanguage];

  return `## ${labels.relatedNotes}`;
}

/**
 * Check if content contains timestamps (e.g., [00:12:34] or [12:34])
 */
export function hasTimestamps(content: string): boolean {
  // Match [HH:MM:SS] or [MM:SS] format
  const timestampPattern = /\[\d{1,2}:\d{2}(?::\d{2})?\]/;
  return timestampPattern.test(content);
}

/**
 * Generate timestamp citation instruction for AI prompt
 * Only included when content has timestamps (podcast/video transcripts)
 * @param content - The content being analyzed
 * @returns Instruction string or empty if no timestamps
 */
export function getTimestampInstruction(content: string): string {
  if (!hasTimestamps(content)) {
    return '';
  }

  return `## Timestamp Citations
The content includes timestamps in [MM:SS] or [HH:MM:SS] format from a podcast/video transcript.
When referencing specific parts of the content, include the relevant timestamp(s) in your response.
Format: Include timestamps like [12:34] or [1:23:45] when citing specific moments.
This helps readers jump to the exact point in the audio/video.`;
}

/**
 * AI Comment feature settings
 */
export interface AICommentSettings {
  /** Feature enabled state */
  enabled: boolean;
  /** Default CLI to use */
  defaultCli: AICli;
  /** Default comment type */
  defaultType: AICommentType;
  /** Platform visibility settings */
  platformVisibility: PlatformVisibility;
  /** Enable multi-AI comparison mode */
  multiAiEnabled: boolean;
  /** CLIs to use in multi-AI mode */
  multiAiSelection: AICli[];
  /** User-defined custom prompts */
  customPrompts: CustomPrompt[];
  /** Vault context settings */
  vaultContext: VaultContextSettings;
  /** Target language for translation */
  translationLanguage?: string;
  /** Output language for AI responses ('auto' = match content language) */
  outputLanguage: AIOutputLanguage;
}

/**
 * Error codes for AI comment failures
 */
export type AICommentErrorCode =
  | 'CLI_NOT_INSTALLED'
  | 'CLI_NOT_AUTHENTICATED'
  | 'CONTENT_TOO_LONG'
  | 'CONTENT_EMPTY'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'PARSE_ERROR'
  | 'PLATFORM_NOT_SUPPORTED'
  | 'VAULT_CONTEXT_ERROR'
  | 'INVALID_PROMPT'
  | 'MODEL_NOT_FOUND'
  | 'UNKNOWN';

/**
 * Default user-facing error messages
 */
const DEFAULT_ERROR_MESSAGES: Record<AICommentErrorCode, string> = {
  CLI_NOT_INSTALLED: 'AI CLI tool is not installed. Please install it first.',
  CLI_NOT_AUTHENTICATED: 'AI CLI tool is not authenticated. Please set up your API key.',
  CONTENT_TOO_LONG: 'Content is too long for AI processing. Try selecting a shorter excerpt.',
  CONTENT_EMPTY: 'No content available to analyze.',
  RATE_LIMITED: 'AI service rate limit reached. Please try again later.',
  NETWORK_ERROR: 'Network error connecting to AI service.',
  TIMEOUT: 'AI processing timed out. Please try again.',
  CANCELLED: 'AI comment generation was cancelled.',
  PARSE_ERROR: 'Failed to parse AI response.',
  PLATFORM_NOT_SUPPORTED: 'AI comments are not supported for this platform.',
  VAULT_CONTEXT_ERROR: 'Failed to load vault context for AI analysis.',
  INVALID_PROMPT: 'Invalid custom prompt template.',
  MODEL_NOT_FOUND: 'Specified AI model not found.',
  UNKNOWN: 'An error occurred during AI comment generation.',
};

/**
 * Custom error class for AI comment failures
 */
export class AICommentError extends Error {
  /** Error code for programmatic handling */
  readonly code: AICommentErrorCode;
  /** User-friendly error message */
  readonly userMessage: string;
  /** CLI that was being used (if applicable) */
  readonly cli?: AICli;

  constructor(code: AICommentErrorCode, message: string, options?: { userMessage?: string; cli?: AICli }) {
    super(message);
    this.name = 'AICommentError';
    this.code = code;
    this.userMessage = options?.userMessage || DEFAULT_ERROR_MESSAGES[code];
    this.cli = options?.cli;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AICommentError);
    }
  }
}

/**
 * Progress update during AI comment generation
 */
export interface AICommentProgress {
  /** Progress percentage (0-100) */
  percentage: number;
  /** Human-readable status message */
  status: string;
  /** CLI being used */
  cli: AICli;
  /** Current phase */
  phase: 'preparing' | 'generating' | 'parsing' | 'complete';
}

/**
 * Options for generating an AI comment
 */
export interface AICommentOptions {
  /** CLI to use */
  cli: AICli;
  /** Provider model to use. Undefined means use the CLI's configured default. */
  model?: string;
  /** Comment type */
  type: AICommentType;
  /** Custom prompt (for 'custom' type) */
  customPrompt?: string;
  /** Vault path for 'connections' type */
  vaultPath?: string;
  /** Current note path (for 'connections' type - to exclude self-reference) */
  currentNotePath?: string;
  /** Target language (for 'translation' type) */
  targetLanguage?: string;
  /** Output language for AI response ('auto' = match content language) */
  outputLanguage?: AIOutputLanguage;
  /** Progress callback */
  onProgress?: (progress: AICommentProgress) => void;
  /** Optional timeout override in milliseconds */
  timeoutMs?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result of AI comment generation
 */
export interface AICommentResult {
  /** Generated comment text */
  content: string;
  /** Metadata about the generation */
  meta: AICommentMeta;
  /** Raw response from CLI (for debugging) */
  rawResponse?: string;
}

/**
 * Multi-AI comparison result (legacy - uses Maps)
 */
export interface MultiAICommentResult {
  /** Results from each CLI */
  results: Map<AICli, AICommentResult>;
  /** Total processing time */
  totalProcessingTime: number;
  /** Any errors that occurred */
  errors: Map<AICli, AICommentError>;
}

/**
 * Result from a single CLI in multi-AI generation
 */
export type MultiAIGenerationResult =
  | { status: 'fulfilled'; cli: AICli; result: AICommentResult }
  | { status: 'rejected'; cli: AICli; error: AICommentError };

// ============================================================================
// Default Values and Constants
// ============================================================================

/**
 * Default AI comment settings
 */
export const DEFAULT_AI_COMMENT_SETTINGS: AICommentSettings = {
  enabled: true,
  defaultCli: 'claude',
  defaultType: 'summary',
  platformVisibility: {
    socialMedia: true,
    blogNews: true,
    videoAudio: true,
    excludedPlatforms: [],
  },
  multiAiEnabled: false,
  multiAiSelection: ['claude', 'gemini'],
  customPrompts: [],
  vaultContext: {
    enabled: true,
    excludePaths: [],
    smartFiltering: true,
    maxContextNotes: 10,
  },
  outputLanguage: 'auto', // Default: match content language
};

/**
 * Shared directive for all AI prompts to ensure direct responses without preamble
 */
const DIRECT_RESPONSE_DIRECTIVE = `## Response Format
CRITICAL: Start your response DIRECTLY with the analysis content.
- Do NOT include preamble like "Here's the summary...", "I'll analyze...", "Based on the content..."
- Do NOT acknowledge the request or explain what you're going to do
- Do NOT start with "Sure", "Certainly", "Okay", "Let me...", "The content was..."
- Just output the requested result immediately, using only the headings required by that format`;

/**
 * Default prompts for each comment type
 * Note: {{languageInstruction}} placeholder will be replaced with the appropriate language directive
 */
export const DEFAULT_PROMPTS: Record<Exclude<AICommentType, 'custom'>, string> = {
  summary: `Provide a summary of the following content. Focus on the main message and key takeaways.

{{summaryFormat}}

{{timestampInstruction}}

{{languageInstruction}}

${DIRECT_RESPONSE_DIRECTIVE}

Content:
{{content}}`,

  factcheck: `Fact-check the content below. Follow these rules strictly:

1. Identify the TOP 3 most important/verifiable factual claims only (not opinions)
2. Do ONE web search that covers the main topic, then verify claims from those results
3. If needed, do at most ONE more targeted search
4. Then immediately write your response - do not do more searches

{{factCheckFormat}}

{{timestampInstruction}}

{{languageInstruction}}

${DIRECT_RESPONSE_DIRECTIVE}

Content:
{{content}}`,

  critique: `Provide a balanced critical analysis of the following content. Consider strengths, weaknesses, and potential biases.

{{critiqueFormat}}

{{timestampInstruction}}

{{languageInstruction}}

${DIRECT_RESPONSE_DIRECTIVE}

Content:
{{content}}`,

  keypoints: `Extract the key points from the following content as a bullet-point list. Include the most important facts, arguments, or insights.

{{keyPointsFormat}}

{{timestampInstruction}}

{{languageInstruction}}

${DIRECT_RESPONSE_DIRECTIVE}

Content:
{{content}}`,

  sentiment: `Analyze the sentiment and tone of the following content. Identify the overall emotional tone and any notable emotional shifts.

{{sentimentFormat}}

{{timestampInstruction}}

{{languageInstruction}}

${DIRECT_RESPONSE_DIRECTIVE}

Content:
{{content}}`,

  connections: `Find connections between this content and other notes in the Obsidian vault at: {{vaultPath}}

## IMPORTANT: Current Note
The content below is from: {{currentNote}}
DO NOT suggest linking to this note itself. Only find OTHER related notes.

## Process (be efficient!)
1. Extract 2-3 key topics/keywords from the content
2. Use ONE Grep search with a broad pattern to find related .md files
3. Read the top 3-5 most promising files (excluding the current note)
4. Write your response immediately - do not do more searches

{{connectionsFormat}}
- Use Obsidian wiki link: [[Note Name]] (exact filename without .md)
- For each connection, one sentence explaining the relationship
- Maximum 5 connections
- Do NOT include [[{{currentNoteName}}]] as a connection

{{languageInstruction}}

${DIRECT_RESPONSE_DIRECTIVE}

Content:
{{content}}`,

  translation: `Translate the following content to {{targetLanguage}}. Maintain the original meaning, tone, and style.

${DIRECT_RESPONSE_DIRECTIVE}

Content:
{{content}}`,

  'translate-transcript': `Translate the following transcript to {{targetLanguage}}.

## CRITICAL RULES
1. Preserve EVERY timestamp exactly as-is: [MM:SS] or [H:MM:SS]
2. Preserve the exact number of lines — each timestamped line must produce exactly one translated line
3. Preserve speaker markers (>> or -) at the start of lines if present
4. Do NOT merge, split, or reorder lines
5. Do NOT add or remove timestamps
6. Translate ONLY the text after the timestamp (and optional speaker marker)

## Example
Input:
[0:00] Hello and welcome to the show
[0:05] Today we discuss architecture

Output (Korean):
[0:00] 안녕하세요, 쇼에 오신 것을 환영합니다
[0:05] 오늘은 아키텍처를 이야기합니다

${DIRECT_RESPONSE_DIRECTIVE}

Transcript:
{{content}}`,

  glossary: `Create a glossary of specialized terms from the content below.

## What to Include
- Technical terms, jargon, specialized vocabulary
- Medical/scientific terminology
- Industry-specific acronyms
- Concepts requiring domain knowledge

## What NOT to Include
- Common everyday words
- Well-known acronyms (USA, CEO, etc.)
- Terms already explained in the content

## Process (IMPORTANT: Be efficient!)
1. Identify the 3-5 MOST important specialized terms
2. Use ONE web search combining multiple terms (e.g., "term1 definition term2 definition term3")
3. If needed, do ONE more search for remaining terms
4. Write your glossary immediately - do NOT search each term individually

{{glossaryFormat}}

{{timestampInstruction}}

{{languageInstruction}}

${DIRECT_RESPONSE_DIRECTIVE}

Content:
{{content}}`,

  reformat: `Reformat the markdown layout of this social media post to improve readability.

## CRITICAL RULES - READ CAREFULLY

### What to MODIFY
- Fix broken line breaks and paragraph spacing
- Add section headers using ## (H2) or ### (H3) - NEVER use # (H1)
- Convert inline lists to proper bullet points (-)
- Add emphasis (**bold**, *italic*) where appropriate
- Fix inconsistent formatting
- Improve visual hierarchy

### What to NEVER CHANGE
- The actual text content (words, sentences, meaning)
- Any URLs, links, or mentions
- The Comments section (## 💬 Comments and everything after)
- Media embeds (![...] image/video references)
- Horizontal rules (---)
- Platform metadata at the bottom
- NEVER use # (H1) headers - file title already serves as H1 in Obsidian

### Content Structure
The content typically has this structure:
1. **Main body text** - REFORMAT THIS
2. Media embeds (![...]) - DO NOT TOUCH
3. Comments section (## 💬 Comments) - DO NOT TOUCH
4. Platform metadata footer - DO NOT TOUCH

### Platform-Specific Guidelines
- **Reddit**: Often has bullet points that need proper formatting, nested quotes
- **Twitter/X**: Short posts, may just need paragraph breaks
- **LinkedIn**: Professional tone, section headers helpful
- **Facebook**: Casual tone, emoji usage common
- **Instagram**: May have hashtags at end, preserve them
- **YouTube**: Description may have timestamps, preserve [MM:SS] format

## Output Format
Return ONLY the reformatted main body text (before any media or comments).
Do NOT include the Comments section or metadata in your output.
Do NOT add explanations - just return the reformatted text.

{{languageInstruction}}

Content to reformat:
{{content}}`,
};

/**
 * Display names for comment types
 */
export const COMMENT_TYPE_DISPLAY_NAMES: Record<AICommentType, string> = {
  summary: 'Summary',
  factcheck: 'Fact Check',
  critique: 'Critical Analysis',
  keypoints: 'Key Points',
  sentiment: 'Sentiment Analysis',
  connections: 'Note Connections',
  translation: 'Translation',
  'translate-transcript': 'Translate Transcript',
  glossary: 'Glossary',
  reformat: 'Reformat',
  custom: 'Custom Prompt',
};

/**
 * Descriptions for comment types
 */
export const COMMENT_TYPE_DESCRIPTIONS: Record<AICommentType, string> = {
  summary: 'Generate a concise summary of the content',
  factcheck: 'Analyze claims and check for potential misinformation',
  critique: 'Provide balanced critical analysis',
  keypoints: 'Extract key points as a bullet list',
  sentiment: 'Analyze emotional tone and sentiment',
  connections: 'Find connections to your other notes',
  translation: 'Translate content to another language',
  'translate-transcript': 'Translate transcript to another language (preserving timestamps)',
  glossary: 'Explain technical and specialized terms',
  reformat: 'Improve markdown formatting without changing content',
  custom: 'Use your own prompt template',
};

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a string is a valid AICli type
 */
export function isAICli(value: string): value is AICli {
  return ['claude', 'gemini', 'codex'].includes(value);
}

/**
 * Check if a string is a valid AICommentType
 */
export function isAICommentType(value: string): value is AICommentType {
  return [
    'summary',
    'factcheck',
    'critique',
    'keypoints',
    'sentiment',
    'connections',
    'translation',
    'translate-transcript',
    'glossary',
    'reformat',
    'custom',
  ].includes(value);
}

/**
 * Check if an error is an AICommentError
 */
export function isAICommentError(error: unknown): error is AICommentError {
  return error instanceof AICommentError;
}

/**
 * Get user-friendly error message for an error code
 */
export function getAICommentErrorMessage(code: AICommentErrorCode): string {
  return DEFAULT_ERROR_MESSAGES[code];
}

/**
 * Generate a unique comment ID
 */
export function generateCommentId(cli: AICli, type: AICommentType): string {
  const now = new Date();
  // Include milliseconds and random suffix for uniqueness
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('.', '').slice(0, 17);
  const random = Math.random().toString(36).substring(2, 6);
  return `${cli}-${type}-${timestamp}-${random}`;
}

/**
 * Create content hash for change detection
 */
export function createContentHash(content: string): string {
  // Simple hash function for content comparison
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
