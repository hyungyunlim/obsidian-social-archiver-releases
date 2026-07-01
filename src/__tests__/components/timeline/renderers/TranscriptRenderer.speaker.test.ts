import { Modal } from 'obsidian';
import { TranscriptRenderer } from '@/components/timeline/renderers/TranscriptRenderer';
import type { TranscriptionSegment } from '@/types/transcription';

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('obsidian');
  return {
    ...actual,
    setIcon(element: HTMLElement, icon: string): void {
      element.dataset.icon = icon;
    },
  };
});

describe('TranscriptRenderer speaker labels', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function renderSegments(segments: TranscriptionSegment[]): HTMLElement {
    const modal = new Modal(null);
    document.body.appendChild(modal.contentEl);

    const renderer = new TranscriptRenderer();
    renderer.render(modal.contentEl, {
      segments,
      startCollapsed: false,
      showSpeakerDividers: true,
    });

    return modal.contentEl;
  }

  it('renders structured speaker labels separately from transcript text', () => {
    const container = renderSegments([
      { id: 0, start: 0, end: 2, text: 'Speaker 1: 안녕하세요.', speaker: 'Speaker 1' },
      { id: 1, start: 2, end: 4, text: '이어서 말합니다.', speaker: 'Speaker 1' },
      { id: 2, start: 4, end: 6, text: '반갑습니다.', speaker: 'Speaker 2' },
    ]);

    const labels = [...container.querySelectorAll<HTMLElement>('.tr-speaker-label')].map((label) =>
      label.textContent
    );
    const texts = [...container.querySelectorAll<HTMLElement>('.segment-text')].map((text) =>
      text.textContent
    );

    expect(labels).toEqual(['Speaker 1', 'Speaker 1', 'Speaker 2']);
    expect(texts).toEqual(['안녕하세요.', '이어서 말합니다.', '반갑습니다.']);
  });

  it('uses structured speaker changes for dividers and jump availability', () => {
    const container = renderSegments([
      { id: 0, start: 0, end: 2, text: '첫 문장', speaker: 'Speaker 1' },
      { id: 1, start: 2, end: 4, text: '같은 화자', speaker: 'Speaker 1' },
      { id: 2, start: 4, end: 6, text: '다른 화자', speaker: 'Speaker 2' },
    ]);

    expect(container.querySelectorAll('.tr-speaker-divider')).toHaveLength(1);
    expect(container.querySelector('.transcript-speaker-jump')?.classList.contains('tr-speaker-enabled')).toBe(true);
  });

  it('splits embedded Speaker prefixes from markdown-only transcript segments', () => {
    const container = renderSegments([
      { id: 0, start: 0, end: 3, text: 'Speaker 2: 자 이제 미팅을 시작하겠습니다.' },
      { id: 1, start: 3, end: 7, text: '박기현 씨 오늘 무슨 2day와 무슨 이슈가 있었나요?' },
      { id: 2, start: 7, end: 14, text: 'Speaker 1: 이미 ABT 시작하고 있는데' },
      { id: 3, start: 14, end: 19, text: '그룹이 맞지가 않는 걸 해달라고 해서 화가 났습니다.' },
    ]);

    const labels = [...container.querySelectorAll<HTMLElement>('.tr-speaker-label')].map((label) =>
      label.textContent
    );
    const texts = [...container.querySelectorAll<HTMLElement>('.segment-text')].map((text) =>
      text.textContent
    );

    expect(labels).toEqual(['Speaker 2', 'Speaker 1']);
    expect(texts).toEqual([
      '자 이제 미팅을 시작하겠습니다.',
      '박기현 씨 오늘 무슨 2day와 무슨 이슈가 있었나요?',
      '이미 ABT 시작하고 있는데',
      '그룹이 맞지가 않는 걸 해달라고 해서 화가 났습니다.',
    ]);
    expect(container.querySelectorAll('.tr-speaker-divider')).toHaveLength(1);
    expect(container.querySelector('.transcript-speaker-jump')?.classList.contains('tr-speaker-enabled')).toBe(true);
  });
});
