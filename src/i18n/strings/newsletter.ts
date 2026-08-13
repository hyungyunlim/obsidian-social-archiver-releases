/**
 * Settings-surface strings: key prefix "news.".
 * Populated by the i18n extraction pass — every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const newsletterStrings = {
  'news.banner.ariaLabel': {
    en: 'Newsletter consent',
    ko: '뉴스레터 수신 동의',
  },
  'news.banner.title': {
    en: 'Stay in the loop?',
    ko: '소식을 받아보시겠어요?',
  },
  'news.banner.desc': {
    en: 'Get occasional product updates and tips.',
    ko: '가끔씩 제품 업데이트와 활용 팁을 보내 드립니다.',
  },
  'news.banner.signUp': {
    en: 'Yes, sign me up',
    ko: '네, 구독할게요',
  },
  'news.banner.noThanks': {
    en: 'No thanks',
    ko: '괜찮아요',
  },
  'news.banner.later': {
    en: 'Decide later',
    ko: '나중에 결정',
  },
  'news.toggle.loadError': {
    en: 'Unable to load newsletter preference.',
    ko: '뉴스레터 설정을 불러올 수 없습니다.',
  },
  'news.toggle.name': {
    en: 'Newsletter',
    ko: '뉴스레터',
  },
  'news.toggle.suppressed': {
    en: 'Disabled due to delivery issue — contact support to re-enable.',
    ko: '메일 발송 문제로 비활성화되었습니다. 다시 사용하려면 지원팀에 문의해 주세요.',
  },
  'news.toggle.desc': {
    en: 'Receive occasional product updates and tips.',
    ko: '가끔씩 제품 업데이트와 활용 팁을 받아보세요.',
  },
  'news.toggle.ariaLabel': {
    en: 'Newsletter opt-in',
    ko: '뉴스레터 수신 설정',
  },
} satisfies Record<string, LocaleText>;
