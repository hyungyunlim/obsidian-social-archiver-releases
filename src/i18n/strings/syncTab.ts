/**
 * Settings-surface strings: key prefix "sync.".
 * Populated by the i18n extraction pass — every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const syncTabStrings = {
  'sync.library.progress.deltaSweep': {
    en: 'Delta sweep…',
    ko: '델타 스윕 진행 중…',
  },
  'sync.library.progress.scanning': {
    en: 'Scanning {scanned} / {total}',
    ko: '스캔 중 {scanned} / {total}',
  },
  'sync.library.progress.scanningIndeterminate': {
    en: 'Scanning… ({scanned} so far)',
    ko: '스캔 중… (현재 {scanned}개)',
  },
  'sync.error.registrationFailed': {
    en: 'Registration failed',
    ko: '등록에 실패했습니다',
  },
  'sync.description': {
    en: 'Enable syncing archives from the mobile app to this vault automatically. When connected, archives saved on your phone will appear here.',
    ko: '모바일 앱의 아카이브를 이 보관함으로 자동으로 동기화합니다. 연결되면 휴대폰에서 저장한 아카이브가 여기에 나타납니다.',
  },
  'sync.status.enabled': {
    en: 'Sync Enabled',
    ko: '동기화 활성화됨',
  },
  'sync.status.clientId': {
    en: 'Client ID: {id}',
    ko: '클라이언트 ID: {id}',
  },
  'sync.button.disconnecting': {
    en: 'Disconnecting...',
    ko: '연결 해제 중...',
  },
  'sync.button.disconnect': {
    en: 'Disconnect',
    ko: '연결 해제',
  },
  'sync.status.notConnected': {
    en: 'Not Connected',
    ko: '연결되지 않음',
  },
  'sync.status.registerHint': {
    en: 'Register this vault to receive archives from mobile.',
    ko: '이 보관함을 등록하면 모바일에서 아카이브를 받을 수 있습니다.',
  },
  'sync.button.connecting': {
    en: 'Connecting...',
    ko: '연결 중...',
  },
  'sync.button.connect': {
    en: 'Connect',
    ko: '연결',
  },
  'sync.download.label': {
    en: 'Get the mobile app',
    ko: '모바일 앱 받기',
  },
  'sync.download.appStore': {
    en: 'Download on the App Store',
    ko: 'App Store에서 다운로드',
  },
  'sync.download.googlePlay': {
    en: 'Get it on Google Play',
    ko: 'Google Play에서 다운로드',
  },
  'sync.annotation.title': {
    en: 'Mobile Annotation Sync',
    ko: '모바일 주석 동기화',
  },
  'sync.annotation.desc': {
    en: 'Sync highlights and notes from the mobile app to vault notes. When enabled, a managed annotation block is appended to matching notes automatically.',
    ko: '모바일 앱의 하이라이트와 메모를 보관함 노트로 동기화합니다. 활성화하면 관리형 주석 블록이 해당 노트에 자동으로 추가됩니다.',
  },
  'sync.linkedArchives.title': {
    en: 'Linked archives section',
    ko: '연결된 아카이브 섹션',
  },
  'sync.linkedArchives.desc.p1': {
    en: 'Add a managed ',
    ko: '관리형 ',
  },
  'sync.linkedArchives.desc.p2': {
    en: ' section with ',
    ko: ' 섹션에 ',
  },
  'sync.linkedArchives.desc.p3': {
    en: ' to related archives, so they show up in Obsidian graph view. Turning this off leaves any existing sections in place.',
    ko: ' 형태의 위키링크로 관련 아카이브를 연결해 Obsidian 그래프 뷰에 표시합니다. 이 옵션을 꺼도 기존 섹션은 그대로 유지됩니다.',
  },
  'sync.recreateOnRepair.title': {
    en: 'Recreate locally-deleted notes on repair',
    ko: '복구 시 로컬에서 삭제한 노트 다시 만들기',
  },
  'sync.recreateOnRepair.desc': {
    en: 'When the server repairs media for an archive whose note you deleted locally, recreate the note. Off by default — repairs only update notes that still exist.',
    ko: '로컬에서 노트를 삭제한 아카이브의 미디어를 서버가 복구할 때 노트를 다시 만듭니다. 기본값은 꺼짐이며, 이 경우 복구는 남아 있는 노트만 업데이트합니다.',
  },
  'sync.info.title': {
    en: 'How Mobile Sync Works',
    ko: '모바일 동기화 동작 방식',
  },
  'sync.info.item1': {
    en: 'Archives saved on your phone are queued for sync',
    ko: '휴대폰에서 저장한 아카이브는 동기화 대기열에 추가됩니다',
  },
  'sync.info.item2': {
    en: 'When Obsidian is open, archives sync automatically via WebSocket',
    ko: 'Obsidian이 열려 있으면 WebSocket을 통해 자동으로 동기화됩니다',
  },
  'sync.info.item3': {
    en: 'Offline? Archives will sync when you reconnect',
    ko: '오프라인 상태라면 다시 연결될 때 동기화됩니다',
  },
  'sync.info.item4': {
    en: 'Each vault can be registered as a separate sync client',
    ko: '각 보관함은 별도의 동기화 클라이언트로 등록할 수 있습니다',
  },
  'sync.library.title': {
    en: 'Archive Library Sync',
    ko: '아카이브 라이브러리 동기화',
  },
  'sync.library.desc': {
    en: 'Syncs existing archives from your server account into the vault. Already-saved notes are skipped.',
    ko: '서버 계정의 기존 아카이브를 보관함으로 동기화합니다. 이미 저장된 노트는 건너뜁니다.',
  },
  'sync.library.stat.saved': {
    en: 'Saved: {count}',
    ko: '저장됨: {count}',
  },
  'sync.library.stat.skipped': {
    en: 'Skipped: {count}',
    ko: '건너뜀: {count}',
  },
  'sync.library.stat.ambiguous': {
    en: 'Ambiguous: {count}',
    ko: '모호함: {count}',
  },
  'sync.library.ambiguous.title': {
    en: 'More than one note holds the same post',
    ko: '같은 게시물을 가진 노트가 둘 이상입니다',
  },
  'sync.library.ambiguous.hint': {
    en: 'Sync left these alone because it cannot tell which one to keep. Keep whichever holds your highlights and notes, then delete the other.',
    ko: '어느 쪽을 남길지 판단할 수 없어 동기화가 건드리지 않았습니다. 하이라이트와 메모가 있는 쪽을 남기고 나머지를 삭제하세요.',
  },
  'sync.library.ambiguous.more': {
    en: 'and {count} more',
    ko: '외 {count}건',
  },
  'sync.library.stat.failed': {
    en: 'Failed: {count}',
    ko: '실패: {count}',
  },
  'sync.library.lastSynced': {
    en: 'Last synced: {date}',
    ko: '마지막 동기화: {date}',
  },
  'sync.library.error': {
    en: 'Error: {message}',
    ko: '오류: {message}',
  },
  'sync.library.unknownError': {
    en: 'Unknown error',
    ko: '알 수 없는 오류',
  },
  'sync.library.interrupted': {
    en: 'Interrupted — click Sync to resume',
    ko: '중단됨 — 동기화 버튼을 눌러 재개해 주세요',
  },
  'sync.library.notYetSynced': {
    en: 'Not yet synced',
    ko: '아직 동기화되지 않음',
  },
  'sync.library.button.syncing': {
    en: 'Syncing…',
    ko: '동기화 중…',
  },
  'sync.library.button.resync': {
    en: 'Re-sync Archives',
    ko: '아카이브 다시 동기화',
  },
  'sync.library.button.sync': {
    en: 'Sync Existing Archives',
    ko: '기존 아카이브 동기화',
  },
  'sync.deleteSync.title': {
    en: 'Delete Sync',
    ko: '삭제 동기화',
  },
  'sync.deleteSync.outbound.title': {
    en: 'Delete from server when archive notes are deleted',
    ko: '아카이브 노트를 삭제하면 서버에서도 삭제',
  },
  'sync.deleteSync.outbound.desc': {
    en: 'When you delete an archive note from this vault, also delete it from the server',
    ko: '이 보관함에서 아카이브 노트를 삭제하면 서버에서도 함께 삭제합니다',
  },
  'sync.deleteSync.inbound.title': {
    en: 'Remove local notes deleted on other devices',
    ko: '다른 기기에서 삭제된 노트를 로컬에서도 제거',
  },
  'sync.deleteSync.inbound.desc': {
    en: 'When an archive is deleted on another device or the server, remove the note from this vault',
    ko: '다른 기기나 서버에서 아카이브가 삭제되면 이 보관함에서도 노트를 제거합니다',
  },
  'sync.deleteSync.pending': {
    en: 'Pending server deletes: {count}',
    ko: '서버 삭제 대기: {count}건',
  },
  'sync.deleteSync.button.retrying': {
    en: 'Retrying…',
    ko: '재시도 중…',
  },
  'sync.deleteSync.button.retry': {
    en: 'Retry Pending Deletes',
    ko: '대기 중인 삭제 재시도',
  },
  'sync.deleteSync.button.clear': {
    en: 'Clear Queue',
    ko: '대기열 비우기',
  },
} satisfies Record<string, LocaleText>;
