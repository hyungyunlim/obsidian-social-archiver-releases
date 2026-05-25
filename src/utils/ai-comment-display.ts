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

export function getAICommentDisplay(meta: Pick<AICommentMeta, 'cli' | 'model' | 'id'>): ProviderDisplay {
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
  return {
    icon: local.icon,
    providerLabel: local.providerLabel,
    modelLabel: '',
    headerLabel: local.providerLabel,
  };
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
