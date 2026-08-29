import type { AICommentMeta } from '../types/ai-comment';

interface ProviderDisplay {
  icon: string;
  providerLabel: string;
  modelLabel: string;
  headerLabel: string;
}

const LOCAL_PROVIDER_DISPLAY: Record<string, Pick<ProviderDisplay, 'icon' | 'providerLabel'>> = {
  claude: { icon: '🤖', providerLabel: 'Claude' },
  gemini: { icon: '✨', providerLabel: 'Gemini' },
  codex: { icon: '💡', providerLabel: 'Codex' },
};

export function getAICommentDisplay(meta: Pick<AICommentMeta, 'cli' | 'model' | 'executedModel' | 'id'>): ProviderDisplay {
  const cloudDisplay = getCloudAIModelDisplay(meta.model);
  if (cloudDisplay) {
    const headerLabel = cloudDisplay.modelLabel
      ? `${cloudDisplay.providerLabel} ${cloudDisplay.modelLabel}`
      : cloudDisplay.providerLabel;
    return {
      icon: '☁️',
      providerLabel: cloudDisplay.providerLabel,
      modelLabel: cloudDisplay.modelLabel,
      headerLabel,
    };
  }

  if (meta.cli === 'workers-ai' || meta.id.startsWith('server-ai-') || meta.id.startsWith('ai-action-comment-')) {
    return {
      icon: '☁️',
      providerLabel: 'Cloud AI',
      modelLabel: '',
      headerLabel: 'Cloud AI',
    };
  }

  const local = LOCAL_PROVIDER_DISPLAY[meta.cli] ?? { icon: '🤖', providerLabel: String(meta.cli || 'AI') };
  // headerLabel stays provider-only: it is written into the markdown comment
  // header, whose `·`-split round-trip parse expects a bare provider name.
  return {
    icon: local.icon,
    providerLabel: local.providerLabel,
    modelLabel: formatAIModelLabel(meta.executedModel || meta.model),
    headerLabel: local.providerLabel,
  };
}

/**
 * Human label for a local model id or alias.
 * "claude-sonnet-4-5-20250929" → "Sonnet 4.5", "claude-3-5-sonnet-20241022" → "Sonnet 3.5",
 * "sonnet" → "Sonnet", "gpt-5.4-mini" → "GPT 5.4 Mini".
 */
export function formatAIModelLabel(raw: string | undefined): string {
  const model = raw?.trim();
  if (!model) return '';
  const lower = model.toLowerCase();

  // claude-<name>-<major>[-<minor>][-YYYYMMDD]  (version parts capped at 3 digits so the date never matches)
  let m = lower.match(/^claude-([a-z]+)(?:-(\d{1,3}))?(?:-(\d{1,3}))?(?:-\d{8})?$/);
  if (m?.[1]) return `${capitalize(m[1])}${formatVersion(m[2], m[3])}`;

  // claude-<major>[-<minor>]-<name>[-YYYYMMDD]  (older id scheme)
  m = lower.match(/^claude-(\d{1,3})(?:-(\d{1,3}))?-([a-z]+)(?:-\d{8})?$/);
  if (m?.[3]) return `${capitalize(m[3])}${formatVersion(m[1], m[2])}`;

  return formatModelParts(model.split(/[-_\s]+/).filter(Boolean));
}

function formatVersion(major?: string, minor?: string): string {
  if (!major) return '';
  return minor ? ` ${major}.${minor}` : ` ${major}`;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function cleanAICommentModelId(model: string): string {
  return model.replace(/^@cf\/(?:[^/]+\/)?/i, '');
}

function getCloudAIModelDisplay(model: string | undefined): Pick<ProviderDisplay, 'providerLabel' | 'modelLabel'> | null {
  const cleaned = cleanAICommentModelId(model?.trim() ?? '');
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  const parts = cleaned.split(/[-_\s]+/).filter(Boolean);

  if (lower.startsWith('glm-')) return { providerLabel: 'GLM', modelLabel: formatModelParts(parts.slice(1)) };
  if (lower.startsWith('kimi-')) return { providerLabel: 'Kimi', modelLabel: formatModelParts(parts.slice(1)) };
  if (lower.startsWith('gemma-')) return { providerLabel: 'Gemma', modelLabel: formatModelParts(parts.slice(1)) };
  if (lower.startsWith('gpt-oss-')) return { providerLabel: 'GPT OSS', modelLabel: formatModelParts(parts.slice(2)) };
  if (lower.startsWith('llama-')) return { providerLabel: 'Llama', modelLabel: formatModelParts(parts.slice(1)) };
  if (lower.startsWith('qwen-')) return { providerLabel: 'Qwen', modelLabel: formatModelParts(parts.slice(1)) };
  if (model?.trim().startsWith('@cf/')) return { providerLabel: formatModelParts(parts) || 'Cloud AI', modelLabel: '' };

  return null;
}

function formatModelParts(parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'gpt') return 'GPT';
      if (lower === 'oss') return 'OSS';
      if (lower === 'ai') return 'AI';
      if (/^\d+b$/i.test(part)) return part.toUpperCase();
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
    })
    .join(' ');
}
