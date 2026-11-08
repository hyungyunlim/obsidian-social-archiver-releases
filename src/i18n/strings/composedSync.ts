/**
 * Composed-post two-way sync — the conflict notice and the "posts that differ
 * from the server" settings row and modal. Key prefix "composed.".
 * Every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const composedSyncStrings = {
  'composed.conflict.notice': {
    en: '“{name}” was edited here and on another device. Your version is saved as a conflict copy. Click to open it.',
    ko: '“{name}”이(가) 여기와 다른 기기에서 함께 수정됐어요. 이 볼트의 내용은 충돌 사본으로 저장했어요. 눌러서 열어 보세요.',
  },
  'composed.conflict.open': { en: 'Open conflict copy', ko: '충돌 사본 열기' },
  'composed.diverged.row.title': {
    en: '{count} of your posts differ from the server',
    ko: '서버와 다른 내 글 {count}개',
  },
  'composed.diverged.row.desc': {
    en: 'These posts were changed both here and on the server before two-way sync. Choose which version to keep.',
    ko: '양방향 동기화 전에 여기와 서버에서 각각 바뀐 글이에요. 남길 버전을 골라 주세요.',
  },
  'composed.diverged.row.button': { en: 'Review', ko: '확인하기' },
  'composed.diverged.modal.title': { en: 'Posts that differ from the server', ko: '서버와 다른 내 글' },
  'composed.diverged.modal.desc': {
    en: '“Use server version” saves this vault’s text as a conflict copy first. “Send vault version” replaces the server copy with this note.',
    ko: '“서버 버전 사용”은 이 볼트의 글을 먼저 충돌 사본으로 저장해요. “볼트 버전 보내기”는 서버의 글을 이 노트로 바꿔요.',
  },
  'composed.diverged.useServer': { en: 'Use server version', ko: '서버 버전 사용' },
  'composed.diverged.sendVault': { en: 'Send vault version', ko: '볼트 버전 보내기' },
  'composed.diverged.open': { en: 'Open', ko: '열기' },
  'composed.diverged.done': { en: 'Post synced.', ko: '글을 맞췄어요.' },
  'composed.diverged.failed': { en: 'Could not sync this post: {message}', ko: '이 글을 맞추지 못했어요: {message}' },
  'composed.diverged.empty': { en: 'All your posts match the server.', ko: '모든 글이 서버와 같아요.' },
} satisfies Record<string, LocaleText>;
