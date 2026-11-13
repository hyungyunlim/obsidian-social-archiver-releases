/**
 * First-run strings: key prefix "firstRun.". The surfaces a brand-new user
 * meets before settings — the empty timeline, the clip guide, the signed-out
 * archive modal and the first-clip notice.
 */
import type { LocaleText } from '../index';

export const firstRunStrings = {
  'firstRun.clipFromBrowser': { en: 'Clip from your browser', ko: '브라우저에서 클립하기' },

  // Timeline empty state
  'firstRun.timeline.title': { en: 'No archived posts yet', ko: '아직 아카이브한 게시물이 없습니다' },
  'firstRun.timeline.message': {
    en: 'Archive your first social media post to see it here!',
    ko: '첫 소셜 미디어 게시물을 아카이브하면 여기에 표시됩니다!',
  },
  'firstRun.timeline.archivePost': { en: 'Archive a post', ko: '게시물 아카이브' },
  'firstRun.timeline.trySample': { en: 'Try with a sample article', ko: '샘플 글로 체험하기' },
  'firstRun.timeline.setUpAccount': { en: 'Set up account', ko: '계정 설정' },
  'firstRun.timeline.viewGuide': { en: 'View guide', ko: '가이드 보기' },

  // ClipGuideModal
  'firstRun.clipGuide.doneOne': { en: '{count} clip saved locally so far', ko: '지금까지 로컬에 저장한 클립 {count}개' },
  'firstRun.clipGuide.doneMany': { en: '{count} clips saved locally so far', ko: '지금까지 로컬에 저장한 클립 {count}개' },
  'firstRun.clipGuide.tagline': {
    en: 'Save posts straight to your vault — no account needed.',
    ko: '계정 없이 게시물을 볼트에 바로 저장하세요.',
  },
  'firstRun.clipGuide.installStep': { en: 'Install the browser extension', ko: '브라우저 확장 프로그램 설치' },
  'firstRun.clipGuide.mobileHint': {
    en: 'Clipping works from a desktop browser — install the extension on your computer.',
    ko: '클립은 데스크톱 브라우저에서 동작합니다 — 컴퓨터에 확장 프로그램을 설치하세요.',
  },
  'firstRun.clipGuide.installButton': { en: 'Install from Chrome Web Store', ko: 'Chrome 웹 스토어에서 설치' },
  'firstRun.clipGuide.guideLink': { en: 'Extension guide', ko: '확장 프로그램 가이드' },
  'firstRun.clipGuide.guideLinkAria': {
    en: 'Extension guide for non-Chrome browsers',
    ko: 'Chrome 이외 브라우저용 확장 프로그램 가이드',
  },
  // Word-order split around the emphasized extension button label.
  'firstRun.clipGuide.clipStep.prefix': {
    en: 'Open a post (X, Instagram, Reddit, …) and click ',
    ko: '게시물(X, Instagram, Reddit 등)을 열고 ',
  },
  'firstRun.clipGuide.clipStep.action': { en: 'Clip to Obsidian', ko: 'Obsidian으로 클립' },
  'firstRun.clipGuide.clipStep.suffix': { en: '', ko: '을 클릭하세요' },
  'firstRun.clipGuide.arriveStep': {
    en: 'Your clip appears in the timeline here — no account needed',
    ko: '클립이 여기 타임라인에 표시됩니다 — 계정이 필요 없습니다',
  },
  'firstRun.clipGuide.footer': {
    en: 'Archiving by URL, sync, and sharing need a free account. ',
    ko: 'URL 아카이브, 동기화, 공유에는 무료 계정이 필요합니다. ',
  },
  'firstRun.openSettings': { en: 'Open settings', ko: '설정 열기' },

  // ArchiveModal, signed out
  'firstRun.archiveModal.title': { en: 'Archive needs a free account', ko: '아카이브하려면 무료 계정이 필요합니다' },
  'firstRun.archiveModal.message': {
    en: 'Archiving by URL runs on the Social Archiver server. Create a free account to archive from any platform, sync with mobile, and share.',
    ko: 'URL 아카이브는 Social Archiver 서버에서 실행됩니다. 무료 계정을 만들면 모든 플랫폼에서 아카이브하고, 모바일과 동기화하고, 공유할 수 있습니다.',
  },
  'firstRun.archiveModal.subMessage': {
    en: 'Free plan available • no password needed • magic link authentication',
    ko: '무료 플랜 제공 • 비밀번호 불필요 • 매직 링크 인증',
  },
  'firstRun.archiveModal.step1': { en: 'Enter email & username', ko: '이메일과 사용자 이름 입력' },
  'firstRun.archiveModal.step2': { en: 'Click magic link in email', ko: '이메일의 매직 링크 클릭' },
  'firstRun.archiveModal.step3': { en: 'Start archiving', ko: '아카이브 시작' },
  'firstRun.archiveModal.or': { en: 'or', ko: '또는' },
  'firstRun.archiveModal.clipInstead': { en: 'Clip from your browser instead', ko: '대신 브라우저에서 클립하기' },
  'firstRun.archiveModal.noAccount': { en: 'No account needed', ko: '계정 필요 없음' },
  'firstRun.archiveModal.disclaimer': {
    en: 'Only archive content you have permission to save',
    ko: '저장할 권한이 있는 콘텐츠만 아카이브하세요',
  },
  'firstRun.archiveModal.openSettings': { en: 'Open settings →', ko: '설정 열기 →' },

  // Clip-import notices
  'firstRun.notice.firstClip': {
    en: 'First clip saved! Find it in your timeline.',
    ko: '첫 클립을 저장했습니다! 타임라인에서 확인하세요.',
  },
  'firstRun.notice.clipped': { en: 'Clipped to vault: {fileName}', ko: '볼트에 클립했습니다: {fileName}' },
} satisfies Record<string, LocaleText>;
