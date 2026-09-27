/**
 * Today's review — the side panel, its entry points and its settings rows.
 * Key prefix "rv.". Every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const reviewStrings = {
  'rv.title': { en: 'Today’s review', ko: '오늘의 복습' },
  'rv.open': { en: 'Open today’s review', ko: '오늘의 복습 열기' },
  'rv.progress': { en: '{index} of {total}', ko: '{index} / {total}' },
  'rv.streak': { en: '{count}-day streak', ko: '{count}일 연속' },
  'rv.loading': { en: 'Preparing today’s review…', ko: '오늘의 복습을 준비하고 있어요…' },
  'rv.signedOut': {
    en: 'Sign in to Social Archiver to see today’s review.',
    ko: '오늘의 복습을 보려면 Social Archiver에 로그인하세요.',
  },
  'rv.openSettings': { en: 'Open settings', ko: '설정 열기' },
  'rv.off': {
    en: 'Review is turned off for your account.',
    ko: '계정에서 복습이 꺼져 있어요.',
  },
  'rv.turnOn': { en: 'Turn on', ko: '켜기' },
  'rv.empty': {
    en: 'Nothing to review today. Archive a few more posts and tomorrow will have more.',
    ko: '오늘은 복습할 글이 없어요. 글을 더 모아 두면 내일 더 보여 드릴게요.',
  },
  'rv.error': { en: 'Couldn’t load today’s review.', ko: '오늘의 복습을 불러오지 못했어요.' },
  'rv.retry': { en: 'Try again', ko: '다시 시도' },
  'rv.recall': { en: 'Try to recall', ko: '떠올려 보세요' },
  'rv.recallImage': { en: 'What was this post about?', ko: '이 글, 어떤 내용이었는지 떠올려 보세요' },
  'rv.gist': { en: 'Gist', ko: '요지' },
  'rv.reveal': { en: 'Show the answer', ko: '답 보기' },
  'rv.highlight': { en: 'Your highlight', ko: '내 하이라이트' },
  'rv.openReader': { en: 'Open in reader', ko: '리더로 보기' },
  'rv.openNote': { en: 'Open note', ko: '노트 열기' },
  'rv.openOriginal': { en: 'Open original', ko: '원문 열기' },
  'rv.previous': { en: 'Previous', ko: '이전' },
  'rv.next': { en: 'Next', ko: '다음' },
  'rv.finish': { en: 'Finish', ko: '마치기' },
  'rv.doneTitle': { en: 'Done for today', ko: '오늘 복습 완료' },
  'rv.todayList': { en: 'Today’s posts', ko: '오늘 본 글' },
  'rv.untitled': { en: 'Untitled post', ko: '제목 없는 글' },
  'rv.statusBar': { en: '{count} to review today', ko: '오늘 복습 {count}개 남음' },

  // Saved age — the server counts, the plugin words it. `.one` = English singular.
  'rv.age.today': { en: 'Saved today', ko: '오늘 저장' },
  'rv.age.yesterday': { en: 'Saved yesterday', ko: '어제 저장' },
  'rv.age.days': { en: 'Saved {count} days ago', ko: '{count}일 전 저장' },
  'rv.age.weeks': { en: 'Saved {count} weeks ago', ko: '{count}주 전 저장' },
  'rv.age.weeks.one': { en: 'Saved 1 week ago', ko: '1주 전 저장' },
  'rv.age.months': { en: 'Saved {count} months ago', ko: '{count}개월 전 저장' },
  'rv.age.months.one': { en: 'Saved 1 month ago', ko: '1개월 전 저장' },
  'rv.age.years': { en: 'Saved {count} years ago', ko: '{count}년 전 저장' },
  'rv.age.years.one': { en: 'Saved 1 year ago', ko: '1년 전 저장' },

  // Settings › Review
  'rv.settings.heading': { en: 'Review', ko: '복습' },
  'rv.settings.enabled.name': { en: 'Daily review', ko: '매일 복습' },
  'rv.settings.enabled.desc': {
    en: 'Re-read a few saved posts and highlights each day. This is your account setting, so it applies on every device.',
    ko: '저장한 글과 하이라이트 몇 개를 매일 다시 보여 줍니다. 계정 설정이라 모든 기기에 적용돼요.',
  },
  'rv.settings.signedOut': {
    en: 'Sign in to use daily review.',
    ko: '로그인하면 매일 복습을 쓸 수 있어요.',
  },
  'rv.settings.statusBar.name': { en: 'Show count in status bar', ko: '상태 표시줄에 남은 개수 표시' },
  'rv.settings.statusBar.desc': {
    en: 'How many cards are left today. Click it to open the review.',
    ko: '오늘 남은 카드 수를 보여 줍니다. 누르면 복습이 열려요.',
  },
  'rv.settings.email.name': { en: 'Email digest', ko: '이메일 다이제스트' },
  'rv.settings.email.desc': {
    en: 'Email today’s review to your account address at {time} each day.',
    ko: '매일 {time}에 오늘의 복습을 계정 이메일로 보내 드려요.',
  },
  'rv.settings.open.name': { en: 'Today’s review', ko: '오늘의 복습' },
  'rv.settings.open.button': { en: 'Open', ko: '열기' },
  'rv.settings.failed': {
    en: 'Couldn’t save the review setting. Try again.',
    ko: '복습 설정을 저장하지 못했어요. 다시 시도해 주세요.',
  },
} satisfies Record<string, LocaleText>;
