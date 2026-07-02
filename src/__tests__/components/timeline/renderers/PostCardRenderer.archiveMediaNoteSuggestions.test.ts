import { describe, expect, it } from 'vitest';
import { Modal, type App, type Vault } from 'obsidian';
import { CommentRenderer } from '@/components/timeline/renderers/CommentRenderer';
import { LinkPreviewRenderer } from '@/components/timeline/renderers/LinkPreviewRenderer';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import { PostCardRenderer, usesAudioArchiveSuggestionFlow } from '@/components/timeline/renderers/PostCardRenderer';
import { YouTubeEmbedRenderer } from '@/components/timeline/renderers/YouTubeEmbedRenderer';
import type SocialArchiverPlugin from '@/main';
import type { PostData } from '@/types/post';

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');

  class Component {
    register(): void {}
    registerEvent(): void {}
    addChild(): void {}
    load(): void {}
    unload(): void {}
  }

  class Scope {
    register(): void {}
  }

  return {
    ...actual,
    Component,
    Scope,
    MarkdownRenderer: {
      render: async (_app: unknown, source: string, element: HTMLElement): Promise<void> => {
        element.textContent = source;
      },
    },
    setIcon(element: HTMLElement, icon: string): void {
      element.dataset.icon = icon;
    },
  };
});

vi.mock('@/utils/whisper', () => ({
  WhisperDetector: {
    estimateTranscriptionTime: vi.fn(() => 60),
    formatEstimatedTime: vi.fn(() => '1m'),
    getInstalledModels: vi.fn(() => ['tiny']),
    getVariant: vi.fn(() => 'whisper.cpp'),
    isAvailable: vi.fn(async () => true),
  },
}));

function makePost(contentType?: PostData['contentType']): Pick<PostData, 'platform' | 'contentType'> {
  return {
    platform: 'post',
    contentType,
  };
}

describe('PostCardRenderer archive media note audio suggestions', () => {
  it('uses the audio download/transcription banner flow for meeting and audio notes', () => {
    expect(usesAudioArchiveSuggestionFlow(makePost('meeting-note'))).toBe(true);
    expect(usesAudioArchiveSuggestionFlow(makePost('audio-note'))).toBe(true);
  });

  it('keeps regular user posts out of the audio suggestion flow', () => {
    expect(usesAudioArchiveSuggestionFlow(makePost('post'))).toBe(false);
    expect(usesAudioArchiveSuggestionFlow(makePost())).toBe(false);
  });

  it('preserves podcast audio suggestion behavior', () => {
    expect(usesAudioArchiveSuggestionFlow({ platform: 'podcast' })).toBe(true);
  });

  it('renders a transcription banner for a local meeting-note audio attachment', async () => {
    const vault = {
      adapter: {
        exists: vi.fn(async () => false),
      },
      getFileByPath: vi.fn(() => null),
      read: vi.fn(async () => ''),
      modify: vi.fn(async () => undefined),
    } as Vault;
    const app = {
      vault,
      metadataCache: {
        getFileCache: vi.fn(() => null),
      },
      workspace: {},
      fileManager: {},
    } as App;
    const plugin = {
      app,
      manifest: { version: '4.1.9-test' },
      settings: {
        username: 'hyungyunlim',
        workerUrl: 'https://social-archiver-api.social-archive.org',
        transcription: {
          enabled: true,
          preferredModel: 'tiny',
          preferredVariant: 'auto',
        },
      },
    } as SocialArchiverPlugin;
    const post: PostData = {
      platform: 'post',
      contentType: 'meeting-note',
      id: 'meeting-note',
      url: 'Social Archives/User Post/meeting-note.md',
      author: { name: 'hyungyunlim', url: 'composed://hyungyunlim/meeting-note' },
      content: { text: 'Ready to transcribe on this iPhone' },
      media: [{ type: 'audio', url: 'attachments/meeting-note.mp4' }],
      metadata: { timestamp: '2026-07-02T06:00:00.000Z' },
    };
    const modal = new Modal(app);
    document.body.appendChild(modal.contentEl);
    const renderer = new PostCardRenderer(
      vault,
      app,
      plugin,
      new MediaGalleryRenderer((path) => path),
      new CommentRenderer(),
      new YouTubeEmbedRenderer(),
      new LinkPreviewRenderer(),
      new Map()
    );

    await renderer.render(modal.contentEl, post);

    const banner = modal.contentEl.querySelector<HTMLElement>('.transcription-suggestion-banner');
    expect(banner).toBeTruthy();
    expect(banner?.dataset.mediaPath).toBe('attachments/meeting-note.mp4');
    expect(banner?.dataset.transcriptionMode).toBe('audio');
    expect(banner?.textContent).toContain('Transcribe with whisper.cpp?');
  });
});
