import { Modal } from 'obsidian';
import { MediaGalleryRenderer } from '@/components/timeline/renderers/MediaGalleryRenderer';
import type { PostData } from '@/types/post';

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return {
    ...actual,
    setIcon(element: HTMLElement, icon: string): void {
      element.dataset.icon = icon;
    },
  };
});

describe('MediaGalleryRenderer archive media note audio player', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  beforeEach(() => {
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    };
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    document.body.innerHTML = '';
  });

  it('renders mp4 meeting-note media through the custom audio player with transcript', () => {
    const post: PostData = {
      platform: 'post',
      contentType: 'meeting-note',
      id: 'meeting-note',
      url: 'Social Archives/User Post/meeting-note.md',
      title: 'Ready to transcribe on this iPhone',
      author: {
        name: 'hyungyunlim',
        url: 'composed://hyungyunlim/meeting-note',
      },
      content: {
        text: 'Ready to transcribe on this iPhone',
      },
      media: [
        {
          type: 'audio',
          url: 'attachments/meeting-note.mp4',
        },
      ],
      metadata: {
        timestamp: '2026-07-02T06:00:00.000Z',
      },
      whisperTranscript: {
        language: 'ko',
        segments: [
          { id: 0, start: 0, end: 3, text: 'Speaker 2: 자 이제 미팅을 시작하겠습니다.' },
          { id: 1, start: 3, end: 7, text: '박기현 씨 오늘 무슨 이슈가 있었나요?' },
        ],
      },
    };

    const modal = new Modal(null);
    document.body.appendChild(modal.contentEl);

    const renderer = new MediaGalleryRenderer((path) => path);
    renderer.renderWithTranscript(modal.contentEl, post.media, post);

    expect(modal.contentEl.querySelector('video')).toBeNull();
    expect(modal.contentEl.querySelector('.social-audio-player')).toBeTruthy();
    expect(modal.contentEl.querySelector('audio')?.getAttribute('src')).toBe('attachments/meeting-note.mp4');
    expect(modal.contentEl.querySelector('.podcast-transcript-container')).toBeTruthy();
    expect(modal.contentEl.querySelector('.tr-speaker-label')?.textContent).toBe('Speaker 2');
    expect(modal.contentEl.querySelector('.segment-text')?.textContent).toBe('자 이제 미팅을 시작하겠습니다.');
  });
});
