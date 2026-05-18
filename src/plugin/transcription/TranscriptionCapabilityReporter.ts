import { Platform } from 'obsidian';
import type { SocialArchiverSettings, WhisperModelType } from '../../types/settings';
import type {
  SyncClient,
  TranscriptionCapabilityStatus,
  TranscriptionExecutorCapability,
  TranscriptionExecutorCapabilityPayload,
  TranscriptionJobMode,
  TranscriptionMediaKind,
  TranscriptionModel,
  TranscriptionModelWithEnglish,
  WorkersAPIClient,
} from '../../services/WorkersAPIClient';
import { WhisperDetector, type WhisperModel, type WhisperVariant } from '../../utils/whisper';
import { MediaToolDetector } from '../../utils/media-tool-detector';
import { YtDlpDetector } from '../../utils/yt-dlp';

const DEBOUNCE_MS = 1500;
const MODEL_SET = new Set<string>(['tiny', 'base', 'small', 'medium', 'large']);
const MODEL_WITH_ENGLISH_SET = new Set<string>([
  'tiny',
  'base',
  'small',
  'medium',
  'large',
  'tiny.en',
  'base.en',
  'small.en',
  'medium.en',
]);

export interface TranscriptionCapabilityReporterDeps {
  apiClient: () => WorkersAPIClient | undefined;
  settings: () => SocialArchiverSettings;
  schedule: (callback: () => void, delay: number) => number;
  clearSchedule: (id: number) => void;
}

export class TranscriptionCapabilityReporter {
  private timer: number | null = null;
  private inFlight: Promise<void> | null = null;
  private lastCapabilityHash: string | undefined;

  constructor(private readonly deps: TranscriptionCapabilityReporterDeps) {}

  dispose(): void {
    if (this.timer !== null) {
      this.deps.clearSchedule(this.timer);
      this.timer = null;
    }
  }

  getCapabilityHash(): string | undefined {
    return this.lastCapabilityHash;
  }

  refreshSoon(): void {
    if (this.timer !== null) {
      this.deps.clearSchedule(this.timer);
    }
    this.timer = this.deps.schedule(() => {
      this.timer = null;
      void this.refreshNow();
    }, DEBOUNCE_MS);
  }

  async refreshNow(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async buildCapabilityPayload(): Promise<TranscriptionExecutorCapabilityPayload | null> {
    if (Platform.isMobile) return null;

    const settings = this.deps.settings();
    const transcription = settings.transcription;
    const [whisper, ffmpeg, ffprobe, ytDlpAvailable] = await Promise.all([
      WhisperDetector.detect(
        transcription?.preferredVariant ?? 'auto',
        transcription?.customWhisperPath,
        transcription?.forceEnableCustomPath,
      ),
      MediaToolDetector.detectFfmpeg(),
      MediaToolDetector.detectFfprobe(),
      YtDlpDetector.isAvailable(),
    ]);

    const preferredModel = normalizeModel(transcription?.preferredModel);
    const installedModels = normalizeInstalledModels(whisper.installedModels);
    const hasExplicitModelInventory = installedModels.length > 0;

    let status: TranscriptionCapabilityStatus = 'ready';
    if (!transcription?.enabled) status = 'settings_disabled';
    else if (!whisper.available) status = 'whisper_missing';
    else if (hasExplicitModelInventory && !installedModels.includes(preferredModel)) status = 'model_missing';
    else if (!ffmpeg.available) status = 'ffmpeg_missing';

    const supportedModes: TranscriptionJobMode[] = ['transcribe-existing-media'];
    if (ytDlpAvailable && ffmpeg.available) {
      supportedModes.push('download-and-transcribe');
    }
    const supportedMediaTypes: TranscriptionMediaKind[] = ['audio', 'video'];

    return {
      enabled: transcription?.enabled === true && status === 'ready',
      runtime: 'desktop',
      status,
      whisper: {
        available: whisper.available,
        variant: normalizeVariant(whisper.variant, transcription?.preferredVariant),
        pathKind: transcription?.customWhisperPath ? 'custom' : whisper.path ? 'path' : null,
        ...(whisper.version ? { version: whisper.version } : {}),
        installedModels,
        preferredModel,
        language: transcription?.language || 'auto',
      },
      ffmpeg: {
        available: ffmpeg.available,
        ...(ffmpeg.version ? { version: ffmpeg.version } : {}),
      },
      ffprobe: {
        available: ffprobe.available,
        ...(ffprobe.version ? { version: ffprobe.version } : {}),
        optional: true,
      },
      ytDlp: {
        available: ytDlpAvailable,
        requiredOnlyForDownloadMode: true,
      },
      supportedMediaTypes,
      supportedModes,
      maxConcurrentJobs: 1,
      updatedAt: new Date().toISOString(),
    };
  }

  private async runRefresh(): Promise<void> {
    if (Platform.isMobile) return;
    const settings = this.deps.settings();
    const clientId = settings.syncClientId;
    const apiClient = this.deps.apiClient();
    if (!apiClient || !settings.authToken || !clientId) return;

    const capability = await this.buildCapabilityPayload();
    if (!capability) return;
    const response = await apiClient.refreshSyncClientCapabilities(
      clientId,
      { transcriptionExecutor: capability },
      'desktop',
    );
    this.lastCapabilityHash = readTranscriptionCapability(response.client)?.capabilityHash;
  }
}

function readTranscriptionCapability(client: SyncClient): TranscriptionExecutorCapability | undefined {
  const settings = client.settings as {
    capabilities?: {
      transcriptionExecutor?: TranscriptionExecutorCapability;
    };
  };
  return settings.capabilities?.transcriptionExecutor;
}

function normalizeModel(value: WhisperModelType | undefined): TranscriptionModel {
  return value && MODEL_SET.has(value) ? (value as TranscriptionModel) : 'small';
}

function normalizeInstalledModels(models: WhisperModel[]): TranscriptionModelWithEnglish[] {
  const result: TranscriptionModelWithEnglish[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    if (!MODEL_WITH_ENGLISH_SET.has(model) || seen.has(model)) continue;
    seen.add(model);
    result.push(model as TranscriptionModelWithEnglish);
  }
  return result;
}

function normalizeVariant(
  detected: WhisperVariant | null,
  preferred: 'auto' | WhisperVariant | undefined,
): TranscriptionExecutorCapabilityPayload['whisper']['variant'] {
  if (detected) return detected;
  if (preferred === 'auto' || preferred === 'faster-whisper' || preferred === 'openai-whisper' || preferred === 'whisper.cpp') {
    return preferred;
  }
  return null;
}
