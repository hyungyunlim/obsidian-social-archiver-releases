/**
 * Settings-surface strings: key prefix "danger.".
 * Populated by the i18n extraction pass — every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const dangerZoneStrings = {
  'danger.deleteAccount.title': { en: 'Delete Account', ko: '계정 삭제' },
  'danger.deleteAccount.message': {
    en: 'This action cannot be undone. All your data will be permanently deleted:\n\n• All shared posts\n• All uploaded images and media\n• Your username and account',
    ko: '이 작업은 되돌릴 수 없습니다. 모든 데이터가 영구적으로 삭제됩니다:\n\n• 모든 공유 포스트\n• 업로드한 모든 이미지와 미디어\n• 사용자 이름과 계정',
  },
  'danger.deleteAccount.confirm': { en: 'Delete My Account', ko: '내 계정 삭제' },
  'danger.cancel': { en: 'Cancel', ko: '취소' },
  'danger.deleteAccount.inputLabelPrefix': {
    en: 'Type your username ',
    ko: '확인하려면 사용자 이름 ',
  },
  'danger.deleteAccount.inputLabelSuffix': {
    en: ' to confirm:',
    ko: '을(를) 입력해 주세요:',
  },
  'danger.deleteAccount.inputPlaceholder': { en: 'Enter your username', ko: '사용자 이름 입력' },
  'danger.reset.title': { en: 'Remove All Shared Posts', ko: '모든 공유 포스트 삭제' },
  'danger.reset.message': {
    en: 'This action removes every published post from social-archive.org and clears any share information stored in your vault.\n\n• Deletes all share links from the cloud\n• Removes share URLs from your local markdown files\n• Stops anyone from accessing your current shared posts',
    ko: '이 작업은 social-archive.org에 게시된 모든 포스트를 삭제하고 보관함에 저장된 공유 정보를 지웁니다.\n\n• 클라우드의 모든 공유 링크 삭제\n• 로컬 마크다운 파일에서 공유 URL 제거\n• 현재 공유된 포스트에 대한 접근 차단',
  },
  'danger.reset.confirm': { en: 'Remove Shared Posts', ko: '공유 포스트 삭제' },
  'danger.reset.inputLabelPrefix': { en: 'Type ', ko: '확인하려면 ' },
  'danger.reset.inputLabelSuffix': { en: ' to confirm:', ko: '을 입력해 주세요:' },
  'danger.reset.inputPlaceholder': {
    en: 'Type RESET to confirm',
    ko: 'RESET을 입력해 확인',
  },
  'danger.header': { en: 'Danger Zone', ko: '위험 구역' },
  'danger.reset.desc': {
    en: 'Delete every published post from social-archive.org and clear share metadata from your vault notes.',
    ko: 'social-archive.org에 게시된 모든 포스트를 삭제하고 보관함 노트에서 공유 메타데이터를 지웁니다.',
  },
  'danger.deleteAccount.desc': {
    en: 'Permanently delete your account and all associated data',
    ko: '계정과 모든 관련 데이터를 영구적으로 삭제합니다',
  },
} satisfies Record<string, LocaleText>;
