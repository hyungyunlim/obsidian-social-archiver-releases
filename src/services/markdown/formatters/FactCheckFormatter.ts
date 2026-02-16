import type { FactCheckResult } from '@/types/post';
import type { AIOutputLanguage, FormatLabels } from '@/types/ai-comment';
import { getFormatLabels } from '@/types/ai-comment';

/**
 * Confidence label translations
 */
const CONFIDENCE_LABELS: Record<Exclude<AIOutputLanguage, 'auto'>, string> = {
  en: 'Confidence',
  ko: '신뢰도',
  ja: '信頼度',
  zh: '置信度',
  es: 'Confianza',
  fr: 'Confiance',
  de: 'Konfidenz',
  pt: 'Confiança',
  ru: 'Уверенность',
  ar: 'الثقة',
  hi: 'विश्वास',
};

/**
 * Evidence label translations
 */
const EVIDENCE_LABELS: Record<Exclude<AIOutputLanguage, 'auto'>, string> = {
  en: 'Evidence',
  ko: '증거',
  ja: '証拠',
  zh: '证据',
  es: 'Evidencia',
  fr: 'Preuve',
  de: 'Beweis',
  pt: 'Evidência',
  ru: 'Доказательство',
  ar: 'الدليل',
  hi: 'साक्ष्य',
};

/**
 * FactCheckFormatter - Format AI fact check results for markdown
 * Single Responsibility: Fact check result formatting
 */
export class FactCheckFormatter {
  /**
   * Format fact checks for markdown
   * @param factChecks - Array of fact check results
   * @param language - Output language for labels (default: 'en')
   */
  formatFactChecks(
    factChecks: FactCheckResult[] | undefined,
    language: AIOutputLanguage = 'en'
  ): string {
    if (!factChecks || factChecks.length === 0) {
      return '';
    }

    const labels = getFormatLabels(language);
    const lang = language === 'auto' ? 'en' : language;
    const confidenceLabel = CONFIDENCE_LABELS[lang];
    const evidenceLabel = EVIDENCE_LABELS[lang];

    return factChecks
      .map((check: FactCheckResult, index: number) => {
        const icon = {
          true: '✅',
          false: '❌',
          misleading: '⚠️',
          unverifiable: '❓',
        }[check.verdict];

        // Get localized verdict label
        const verdictText = this.getLocalizedVerdict(check.verdict, labels);

        return `**${index + 1}. ${icon} ${check.claim}**
- ${labels.verdict}: ${verdictText}
- ${confidenceLabel}: ${(check.confidence * 100).toFixed(0)}%
- ${evidenceLabel}: ${check.evidence}`;
      })
      .join('\n\n');
  }

  /**
   * Get localized verdict text
   */
  private getLocalizedVerdict(
    verdict: 'true' | 'false' | 'misleading' | 'unverifiable',
    labels: FormatLabels
  ): string {
    const verdictMap: Record<string, string> = {
      true: labels.verdictVerified,
      false: labels.verdictFalse,
      misleading: labels.verdictPartiallyTrue,
      unverifiable: labels.verdictUnverifiable,
    };
    return verdictMap[verdict] || verdict;
  }
}
