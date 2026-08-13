/**
 * Settings-surface strings: key prefix "st.".
 * Populated by the i18n extraction pass — every entry is { en, ko }.
 */
import type { LocaleText } from '../index';

export const settingTabStrings = {
  // --- Tab description ---
  'st.tab.desc': {
    en: 'Archive and save social media posts to your Obsidian vault',
    ko: '소셜 미디어 포스트를 Obsidian 보관함에 아카이브하고 저장합니다',
  },

  // --- View section ---
  'st.view.heading': { en: 'View', ko: '보기' },
  'st.view.useDefault': { en: 'Use default', ko: '기본값 사용' },
  'st.view.rightSidebar': { en: 'Right sidebar', ko: '오른쪽 사이드바' },
  'st.view.mainTab': { en: 'Main tab', ko: '메인 탭' },
  'st.view.defaultLocation.name': { en: 'Default view location', ko: '기본 보기 위치' },
  'st.view.defaultLocation.desc': {
    en: 'Where views open by default. Individual views below can override this.',
    ko: '보기가 기본으로 열리는 위치입니다. 아래에서 보기별로 재정의할 수 있습니다.',
  },
  'st.view.timeline.name': { en: 'Timeline view', ko: '타임라인 보기' },
  'st.view.timeline.desc': {
    en: 'Override the default location for the timeline view.',
    ko: '타임라인 보기의 기본 위치를 재정의합니다.',
  },
  'st.view.authorDetail.name': { en: 'Author detail', ko: '작성자 상세' },
  'st.view.authorDetail.desc': {
    en: 'Override the default location for the author detail view.',
    ko: '작성자 상세 보기의 기본 위치를 재정의합니다.',
  },
  'st.view.defaultSort.name': { en: 'Default timeline sort', ko: '기본 타임라인 정렬' },
  'st.view.defaultSort.desc': {
    en: 'Choose whether new timeline views start from archive date or publish date.',
    ko: '새 타임라인 보기를 아카이브 날짜와 게시 날짜 중 무엇으로 시작할지 선택합니다.',
  },
  'st.view.sortArchived': { en: 'Archive date', ko: '아카이브 날짜' },
  'st.view.sortPublished': { en: 'Publish date', ko: '게시 날짜' },

  // --- Instagram Saved Import section ---
  'st.igImport.heading': {
    en: 'Instagram Saved Import (Experimental)',
    ko: 'Instagram 저장됨 가져오기 (실험적)',
  },
  'st.igImport.enable.name': {
    en: 'Enable Instagram Saved import',
    ko: 'Instagram 저장됨 가져오기 활성화',
  },
  'st.igImport.enable.descMobile': {
    en: 'Desktop-only. Run the import on desktop, then sync to mobile.',
    ko: '데스크톱 전용 기능입니다. 데스크톱에서 가져오기를 실행한 뒤 모바일로 동기화해 주세요.',
  },
  'st.igImport.enable.descDesktop': {
    en: 'Import Instagram Saved Posts from a .zip file exported by the Social Archiver Chrome extension. Adds a ribbon icon and a Command Palette entry. Experimental — requires a compatible export package.',
    ko: 'Social Archiver Chrome 확장 프로그램에서 내보낸 .zip 파일로 Instagram 저장된 포스트를 가져옵니다. 리본 아이콘과 명령어 팔레트 항목이 추가됩니다. 실험적 기능으로, 호환되는 내보내기 패키지가 필요합니다.',
  },

  // --- Archive section ---
  'st.archive.heading': { en: 'Archive', ko: '아카이브' },
  'st.archive.keepFailed.name': {
    en: 'Keep failed archive attempts',
    ko: '실패한 아카이브 시도 보관',
  },
  'st.archive.keepFailed.desc': {
    en: 'Save failed or limited archives with site metadata for later review.',
    ko: '실패했거나 제한된 아카이브를 사이트 메타데이터와 함께 저장해 나중에 확인할 수 있습니다.',
  },
  'st.archive.keepFailed.signIn': {
    en: 'Sign in to sync failed archive behavior across clients.',
    ko: '로그인하면 실패한 아카이브 동작 설정이 모든 클라이언트에 동기화됩니다.',
  },
  'st.archive.keepFailed.loadFailed': {
    en: 'Failed to load archive behavior settings: {message}',
    ko: '아카이브 동작 설정을 불러오지 못했습니다: {message}',
  },
  'st.archive.keepFailed.loadFailedGeneric': {
    en: 'Failed to load archive behavior settings.',
    ko: '아카이브 동작 설정을 불러오지 못했습니다.',
  },
  'st.archive.placeSearch.name': { en: 'Default place search', ko: '기본 장소 검색' },
  'st.archive.placeSearch.desc': {
    en: 'Auto uses Kakao for Korean and Google Maps for other app languages. This account setting syncs across clients.',
    ko: '자동은 한국어에서는 Kakao를, 그 외 앱 언어에서는 Google Maps를 사용합니다. 이 계정 설정은 모든 클라이언트에 동기화됩니다.',
  },
  'st.archive.placeSearch.auto': { en: 'Auto (app language)', ko: '자동 (앱 언어)' },
  'st.archive.placeSearch.signIn': {
    en: 'Sign in to sync the default place search provider across clients.',
    ko: '로그인하면 기본 장소 검색 제공자가 모든 클라이언트에 동기화됩니다.',
  },
  'st.archive.placeSearch.loadFailed': {
    en: 'Failed to load place search provider: {message}',
    ko: '장소 검색 제공자를 불러오지 못했습니다: {message}',
  },
  'st.archive.placeSearch.loadFailedGeneric': {
    en: 'Failed to load place search provider.',
    ko: '장소 검색 제공자를 불러오지 못했습니다.',
  },
  'st.archive.folder.name': { en: 'Archive folder', ko: '아카이브 폴더' },
  'st.archive.folder.desc': {
    en: 'Folder where archived posts will be saved',
    ko: '아카이브한 포스트를 저장할 폴더입니다',
  },
  'st.archive.structure.name': { en: 'Archive folder structure', ko: '아카이브 폴더 구조' },
  'st.archive.structure.desc': {
    en: 'Choose how notes are organized under archive folder',
    ko: '아카이브 폴더 아래에서 노트를 어떻게 정리할지 선택합니다',
  },
  'st.archive.structure.platformYearMonth': {
    en: 'Archive folder/platform/year/month',
    ko: '아카이브 폴더/플랫폼/연/월',
  },
  'st.archive.structure.platformOnly': {
    en: 'Archive folder/platform',
    ko: '아카이브 폴더/플랫폼',
  },
  'st.archive.structure.flat': { en: 'Archive folder only', ko: '아카이브 폴더만' },
  'st.archive.mediaFolder.name': { en: 'Media folder', ko: '미디어 폴더' },
  'st.archive.mediaFolder.desc': {
    en: 'Folder where downloaded media files will be saved',
    ko: '다운로드한 미디어 파일을 저장할 폴더입니다',
  },
  'st.archive.filename.name': { en: 'Filename format', ko: '파일 이름 형식' },
  'st.archive.filename.desc': {
    en: 'Template for archived note filenames. Click tokens to insert at cursor.',
    ko: '아카이브 노트 파일 이름의 템플릿입니다. 토큰을 클릭하면 커서 위치에 삽입됩니다.',
  },
  'st.common.resetToDefault': { en: 'Reset to default', ko: '기본값으로 재설정' },
  'st.token.date': { en: 'Date', ko: '날짜' },
  'st.token.archived': { en: 'Archived', ko: '아카이브 날짜' },
  'st.token.platform': { en: 'Platform', ko: '플랫폼' },
  'st.token.author': { en: 'Author', ko: '작성자' },
  'st.token.title': { en: 'Title', ko: '제목' },
  'st.token.slug': { en: 'Slug', ko: '슬러그' },
  'st.token.postId': { en: 'Post ID', ko: '포스트 ID' },
  'st.token.shortId': { en: 'Short ID', ko: '짧은 ID' },
  'st.token.displayName': { en: 'Display name', ko: '표시 이름' },
  'st.token.handle': { en: 'Handle', ko: '핸들' },
  'st.common.insertToken': { en: 'Insert {token}', ko: '{token} 삽입' },
  'st.common.preview': { en: 'Preview: ', ko: '미리보기: ' },
  'st.archive.downloadMedia.name': { en: 'Download media', ko: '미디어 다운로드' },
  'st.archive.downloadMedia.desc': {
    en: 'Choose what media to download with posts. This setting serves as the default for the archive modal.',
    ko: '포스트와 함께 다운로드할 미디어를 선택합니다. 이 설정은 아카이브 모달의 기본값으로 사용됩니다.',
  },
  'st.archive.downloadMedia.textOnly': { en: 'Text only', ko: '텍스트만' },
  'st.archive.downloadMedia.imagesOnly': { en: 'Images only', ko: '이미지만' },
  'st.archive.downloadMedia.imagesAndVideos': { en: 'Images and videos', ko: '이미지와 동영상' },
  'st.archive.largeVideo.name': {
    en: 'Large video prompt threshold (MB)',
    ko: '대용량 동영상 확인 기준 (MB)',
  },
  'st.archive.largeVideo.desc': {
    en: 'Prompt before downloading videos larger than this size. Set to 0 to always download without prompting.',
    ko: '이 크기보다 큰 동영상을 다운로드하기 전에 확인합니다. 0으로 설정하면 항상 확인 없이 다운로드합니다.',
  },
  'st.archive.includeComments.name': { en: 'Include comments', ko: '댓글 포함' },
  'st.archive.includeComments.desc': {
    en: 'Include platform comments in archived notes. When disabled, only the post content and your personal notes are saved. This setting serves as the default for the archive modal.',
    ko: '아카이브 노트에 플랫폼 댓글을 포함합니다. 비활성화하면 포스트 내용과 개인 메모만 저장됩니다. 이 설정은 아카이브 모달의 기본값으로 사용됩니다.',
  },
  'st.archive.hashtags.name': {
    en: 'Include hashtags as Obsidian tags',
    ko: '해시태그를 Obsidian 태그로 포함',
  },
  'st.archive.hashtags.desc': {
    en: 'When enabled, extracted hashtags are rendered as Obsidian tags. Disable this to keep hashtags visible without creating native tags in your vault.',
    ko: '활성화하면 추출된 해시태그가 Obsidian 태그로 표시됩니다. 비활성화하면 보관함에 실제 태그를 만들지 않고 해시태그만 표시합니다.',
  },

  // --- Signed-out row ---
  'st.signedOut.name': { en: 'Sign in to enable', ko: '로그인 후 사용 가능' },
  'st.signedOut.button': { en: 'Sign in', ko: '로그인' },
  // en copy mirrors CAPABILITY_COPY in src/utils/accountGate.ts (Notice surface, Phase 2)
  'st.signedOut.desc.sync': {
    en: 'Syncing with the mobile app runs through your account. Sign in to enable it.',
    ko: '모바일 앱과의 동기화는 계정을 통해 이루어집니다. 로그인하면 사용할 수 있습니다.',
  },
  'st.signedOut.desc.crosspost': {
    en: 'Cross-posting publishes through your account and needs a free account.',
    ko: '크로스 포스팅은 계정을 통해 이루어지며 무료 계정이 필요합니다.',
  },
  'st.signedOut.desc.share': {
    en: 'Share links are hosted on social-archive.org and need a free account.',
    ko: '공유 링크는 social-archive.org에서 호스팅되며 무료 계정이 필요합니다.',
  },
  'st.signedOut.desc.aiComments': {
    en: 'AI comments run on the Social Archiver server and need a free account.',
    ko: 'AI 코멘트는 Social Archiver 서버에서 실행되며 무료 계정이 필요합니다.',
  },

  // --- Mobile sync / Cross-posting headings ---
  'st.mobileSync.heading': { en: 'Mobile sync', ko: '모바일 동기화' },
  'st.crossPost.heading': { en: 'Cross-posting', ko: '크로스 포스팅' },

  // --- Update notifications section ---
  'st.updates.heading': { en: 'Update notifications', ko: '업데이트 알림' },
  'st.updates.releaseNotes.name': { en: 'Release notes', ko: '릴리스 노트' },
  'st.updates.releaseNotes.desc': {
    en: 'Open the shared Social Archiver release notes hub',
    ko: 'Social Archiver 통합 릴리스 노트 허브를 엽니다',
  },
  'st.updates.releaseNotes.button': { en: 'View release notes', ko: '릴리스 노트 보기' },
  'st.updates.showAfterUpdate.name': {
    en: 'Show release notes after updates',
    ko: '업데이트 후 릴리스 노트 표시',
  },
  'st.updates.showAfterUpdate.desc': {
    en: 'Display a modal with new features and changes when the plugin updates',
    ko: '플러그인이 업데이트되면 새 기능과 변경 사항을 모달로 표시합니다',
  },

  // --- Support section ---
  'st.support.heading': { en: 'Support', ko: '지원' },
  'st.support.about.name': { en: 'About the creator', ko: '만든 사람' },
  'st.support.about.desc': {
    en: 'Hey, I’m Hyungyun Jun Lim. I’m a startup founder and builder, and I build Social Archiver as a solo side project. I created it for people like me who want local archives because posts get deleted, platforms change, and content disappears. Feel free to reach out on GitHub for feedback or business inquiries.',
    ko: '안녕하세요, Hyungyun Jun Lim입니다. 스타트업 창업자이자 빌더로, Social Archiver를 1인 사이드 프로젝트로 만들고 있습니다. 포스트가 삭제되고 플랫폼이 바뀌고 콘텐츠가 사라지기에, 저처럼 로컬 아카이브를 원하는 분들을 위해 만들었습니다. 피드백이나 비즈니스 문의는 GitHub로 편하게 연락해 주세요.',
  },
  'st.support.about.button': { en: 'GitHub profile', ko: 'GitHub 프로필' },

  // --- Naver section ---
  'st.naver.desc': {
    en: 'Configure settings for archiving content from Naver blog, cafe, and news.',
    ko: 'Naver 블로그, 카페, 뉴스 콘텐츠 아카이브를 위한 설정입니다.',
  },
  'st.naver.cookieRow.desc': {
    en: 'Copy the {name} cookie value',
    ko: '{name} 쿠키 값을 복사해 붙여넣어 주세요',
  },
  'st.naver.cookieRow.placeholder': { en: 'Paste {name} value', ko: '{name} 값 붙여넣기' },
  'st.naver.cookie.name': { en: 'Cookie', ko: '쿠키' },
  'st.naver.cookie.line1': {
    en: 'For private/member-only cafes. ',
    ko: '비공개/멤버 전용 카페용입니다. ',
  },
  'st.naver.cookie.line2': {
    en: 'Get from Chrome: F12 → Application → Cookies → naver.com',
    ko: 'Chrome에서 확인: F12 → Application → Cookies → naver.com',
  },
  'st.naver.cookie.link': { en: 'How to get Naver cookies →', ko: 'Naver 쿠키 얻는 방법 →' },
  'st.naver.tip.label': { en: 'Tip:', ko: '팁:' },
  'st.naver.tip.text': {
    en: ' Leave empty for public blogs and cafes. Only needed for private cafes that require login.',
    ko: ' 공개 블로그와 카페는 비워 두세요. 로그인이 필요한 비공개 카페에만 필요합니다.',
  },

  // --- Webtoon streaming section ---
  'st.webtoon.heading': { en: 'Webtoon streaming', ko: '웹툰 스트리밍' },
  'st.webtoon.info.strong': { en: 'Streaming mode', ko: '스트리밍 모드' },
  'st.webtoon.info.text': {
    en: ' loads webtoon episodes instantly without waiting for downloads.',
    ko: '는 다운로드를 기다리지 않고 웹툰 에피소드를 즉시 불러옵니다.',
  },
  'st.webtoon.info.li1': {
    en: 'Images are proxied through our server to bypass CORS restrictions',
    ko: '이미지는 CORS 제한을 우회하기 위해 서버 프록시를 통해 불러옵니다',
  },
  'st.webtoon.info.li2': {
    en: 'Background download saves episodes for offline reading',
    ko: '백그라운드 다운로드는 오프라인 감상을 위해 에피소드를 저장합니다',
  },
  'st.webtoon.info.li3': {
    en: 'Prefetch pre-loads the next episode for seamless transitions',
    ko: '프리페치는 다음 에피소드를 미리 불러와 끊김 없이 이어 볼 수 있게 합니다',
  },
  'st.webtoon.loadingMode.name': { en: 'Episode loading mode', ko: '에피소드 로딩 방식' },
  'st.webtoon.loadingMode.desc': {
    en: 'Stream-first: load immediately via proxy (faster). Download-first: wait for full download (offline ready).',
    ko: '스트리밍 우선: 프록시로 즉시 불러옵니다(더 빠름). 다운로드 우선: 전체 다운로드를 기다립니다(오프라인 대비).',
  },
  'st.webtoon.streamFirst': { en: 'Stream first (recommended)', ko: '스트리밍 우선 (권장)' },
  'st.webtoon.downloadFirst': { en: 'Download first', ko: '다운로드 우선' },
  'st.webtoon.bgDownload.name': { en: 'Background download', ko: '백그라운드 다운로드' },
  'st.webtoon.bgDownload.desc': {
    en: 'Automatically download streamed episodes to vault for offline access.',
    ko: '스트리밍한 에피소드를 보관함에 자동으로 다운로드해 오프라인에서도 볼 수 있습니다.',
  },
  'st.webtoon.prefetch.name': { en: 'Prefetch next episode', ko: '다음 에피소드 미리 불러오기' },
  'st.webtoon.prefetch.desc': {
    en: 'Pre-load next episode data when reaching end of current episode for faster transitions.',
    ko: '현재 에피소드 끝에 도달하면 다음 에피소드를 미리 불러와 더 빠르게 전환합니다.',
  },
  'st.webtoon.dataSaver.name': { en: 'Mobile data saver', ko: '모바일 데이터 절약' },
  'st.webtoon.dataSaver.desc': {
    en: 'Load lower quality images to reduce data usage on mobile networks.',
    ko: '모바일 네트워크에서 데이터 사용량을 줄이기 위해 저화질 이미지를 불러옵니다.',
  },

  // --- Local archives section ---
  'st.local.heading': { en: 'Local archives', ko: '로컬 아카이브' },
  'st.local.countOne': { en: '1 local archive', ko: '로컬 아카이브 1개' },
  'st.local.countOther': { en: '{count} local archives', ko: '로컬 아카이브 {count}개' },
  'st.local.inVault.name': { en: 'Local archives in this vault', ko: '이 보관함의 로컬 아카이브' },
  'st.local.inVault': { en: '{countLabel} in this vault', ko: '이 보관함의 {countLabel}' },
  'st.local.inVault.signIn': {
    en: 'Sign in to import them to your account.',
    ko: '로그인하면 계정으로 가져올 수 있습니다.',
  },
  'st.local.inVault.clipsLocal': {
    en: 'Browser clips are stored only in this vault.',
    ko: '브라우저 클립은 이 보관함에만 저장됩니다.',
  },
  'st.local.import.name': { en: 'Import local archives', ko: '로컬 아카이브 가져오기' },
  'st.local.notImported': {
    en: '{countLabel} not yet imported',
    ko: '아직 가져오지 않은 {countLabel}',
  },
  'st.local.import.button': { en: 'Import local archives…', ko: '로컬 아카이브 가져오기…' },
  'st.local.autoUpload.name': { en: 'Auto-upload new clips', ko: '새 클립 자동 업로드' },
  'st.local.autoUpload.signIn': {
    en: 'Sign in to enable. Uploads count against your monthly archive quota.',
    ko: '로그인 후 사용할 수 있습니다. 업로드는 월간 아카이브 할당량에서 차감됩니다.',
  },
  'st.local.autoUpload.paid': {
    en: 'Automatically upload new browser clips to your account. Each upload counts against your monthly archive quota.',
    ko: '새 브라우저 클립을 계정에 자동으로 업로드합니다. 업로드할 때마다 월간 아카이브 할당량에서 차감됩니다.',
  },
  'st.local.autoUpload.free': {
    en: 'Available on paid plans. Each upload counts against your monthly archive quota.',
    ko: '유료 플랜에서 사용할 수 있습니다. 업로드할 때마다 월간 아카이브 할당량에서 차감됩니다.',
  },
  'st.local.summary': {
    en: 'Last import ({date}): {imported} imported · {duplicates} {duplicateWord} · {partialMedia} partial media · {remaining} remaining ({reason})',
    ko: '마지막 가져오기 ({date}): 가져옴 {imported}건 · 중복 {duplicates}건 · 부분 미디어 {partialMedia}건 · 남음 {remaining}건 ({reason})',
  },
  'st.local.summary.duplicateOne': { en: 'duplicate', ko: '중복' },
  'st.local.summary.duplicateOther': { en: 'duplicates', ko: '중복' },
  'st.local.summary.completed': { en: 'completed', ko: '완료' },
  'st.local.summary.quota': { en: 'monthly quota reached', ko: '월간 할당량 도달' },
  'st.local.summary.error': { en: 'stopped on error', ko: '오류로 중단됨' },

  // --- Sharing section ---
  'st.share.heading': { en: 'Sharing', ko: '공유' },
  'st.share.mode.name': { en: 'Share mode', ko: '공유 모드' },
  'st.share.mode.desc': {
    en: 'Choose how shared posts appear on the web. "preview" mode protects copyright by showing only excerpts without media.',
    ko: '공유한 포스트가 웹에서 어떻게 표시될지 선택합니다. "미리보기" 모드는 미디어 없이 발췌만 표시해 저작권을 보호합니다.',
  },
  'st.share.mode.preview': { en: 'Preview (copyright-safe)', ko: '미리보기 (저작권 안전)' },
  'st.share.mode.full': { en: 'Full content (original)', ko: '전체 내용 (원본)' },
  'st.share.readerLink.name': {
    en: 'Copy reader mode link by default',
    ko: '기본으로 리더 모드 링크 복사',
  },
  'st.share.readerLink.desc': {
    en: 'When creating a share link, copy the reader-mode URL (#reader). Disable to copy the normal post URL.',
    ko: '공유 링크를 만들 때 리더 모드 URL(#reader)을 복사합니다. 비활성화하면 일반 포스트 URL을 복사합니다.',
  },
  'st.share.previewLength.name': { en: 'Preview length', ko: '미리보기 길이' },
  'st.share.previewLength.desc': {
    en: 'Maximum character count for text preview in "preview" mode. Platform link is always included in preview mode.',
    ko: '"미리보기" 모드에서 텍스트 미리보기의 최대 글자 수입니다. 미리보기 모드에서는 플랫폼 링크가 항상 포함됩니다.',
  },

  // --- Account section ---
  'st.account.heading': { en: 'Account', ko: '계정' },

  // --- Local command execution notice ---
  'st.shellNotice.name': { en: 'Local command execution', ko: '로컬 명령 실행' },
  'st.shellNotice.desc': {
    en: 'Obsidian may show a Shell Execution warning for Social Archiver. The plugin can run local command-line tools only for desktop features you enable or request: AI comments (Claude/Gemini/Codex CLI), Whisper transcription, video downloads (yt-dlp/ffmpeg), and optional Supertonic TTS. Mobile Obsidian does not run these local shell commands.',
    ko: 'Obsidian이 Social Archiver에 대해 셸 실행 경고를 표시할 수 있습니다. 플러그인은 사용자가 직접 활성화하거나 요청한 데스크톱 기능에서만 로컬 명령줄 도구를 실행합니다: AI 코멘트(Claude/Gemini/Codex CLI), Whisper 전사, 동영상 다운로드(yt-dlp/ffmpeg), 선택적 Supertonic TTS. 모바일 Obsidian에서는 이러한 로컬 셸 명령을 실행하지 않습니다.',
  },

  // --- Text-to-Speech section ---
  'st.tts.heading': { en: 'Text-to-Speech', ko: '텍스트 음성 변환' },
  'st.tts.license': {
    en: 'Supertonic model license: OpenRAIL-M. Code: MIT.',
    ko: 'Supertonic 모델 라이선스: OpenRAIL-M. 코드: MIT.',
  },
  'st.tts.provider.name': { en: 'TTS Provider', ko: 'TTS 제공자' },
  'st.tts.provider.desc': {
    en: 'Choose between cloud (Azure) or on-device (Supertonic) speech synthesis',
    ko: '클라우드(Azure)와 온디바이스(Supertonic) 음성 합성 중에서 선택합니다',
  },
  'st.tts.provider.azure': { en: 'Azure Cloud', ko: 'Azure 클라우드' },
  'st.tts.provider.supertonic': {
    en: 'Supertonic (on-device, desktop only)',
    ko: 'Supertonic (온디바이스, 데스크톱 전용)',
  },
  'st.tts.install.name': { en: 'Install Supertonic engine', ko: 'Supertonic 엔진 설치' },
  'st.tts.install.desc': {
    en: 'Install the on-device speech engine.',
    ko: '온디바이스 음성 엔진을 설치합니다.',
  },
  'st.tts.updateTo': { en: 'Update to v{version}', ko: 'v{version}(으)로 업데이트' },
  'st.tts.install.button': { en: 'Install', ko: '설치' },
  'st.tts.updating': { en: 'Updating...', ko: '업데이트 중...' },
  'st.tts.installing': { en: 'Installing...', ko: '설치 중...' },
  'st.tts.install.foundDesc': {
    en: 'Found Supertonic v{installed}. Update to v{target} to enable Supertonic 3 support.',
    ko: 'Supertonic v{installed}이(가) 설치되어 있습니다. Supertonic 3 지원을 위해 v{target}(으)로 업데이트해 주세요.',
  },
  'st.tts.install.notInstalledDesc': {
    en: 'Not installed. Downloads ~415MB of models for on-device TTS (desktop only).',
    ko: '설치되어 있지 않습니다. 온디바이스 TTS를 위해 약 415MB의 모델을 다운로드합니다 (데스크톱 전용).',
  },
  'st.tts.speed.name': { en: 'Speech speed', ko: '말하기 속도' },
  'st.tts.speed.desc': { en: 'Playback speed (0.5x to 2.0x)', ko: '재생 속도 (0.5x ~ 2.0x)' },
  'st.tts.highlight.name': { en: 'Highlight current sentence', ko: '현재 문장 강조' },
  'st.tts.highlight.desc': {
    en: 'Highlight the sentence being spoken in Reader Mode',
    ko: '리더 모드에서 재생 중인 문장을 강조 표시합니다',
  },
  'st.tts.scroll.name': { en: 'Auto-scroll to sentence', ko: '문장으로 자동 스크롤' },
  'st.tts.scroll.desc': {
    en: 'Automatically scroll to keep the current sentence visible',
    ko: '현재 문장이 보이도록 자동으로 스크롤합니다',
  },
  'st.tts.azureNote': {
    en: 'Azure Speech uses your Social Archiver account. Login required.',
    ko: 'Azure Speech는 Social Archiver 계정을 사용합니다. 로그인이 필요합니다.',
  },
  'st.tts.engine.name': { en: 'Supertonic engine', ko: 'Supertonic 엔진' },
  'st.tts.versionUnknown': { en: 'unknown', ko: '알 수 없음' },
  'st.tts.engine.updateDesc': {
    en: 'Installed (v{installed}). Update to v{target} for Supertonic 3 support.',
    ko: '설치됨 (v{installed}). Supertonic 3 지원을 위해 v{target}(으)로 업데이트해 주세요.',
  },
  'st.tts.engine.installedDesc': {
    en: 'Installed (v{installed}). Runs locally on your machine.',
    ko: '설치됨 (v{installed}). 이 컴퓨터에서 로컬로 실행됩니다.',
  },
  'st.tts.uninstall': { en: 'Uninstall', ko: '제거' },
  'st.tts.uninstalling': { en: 'Uninstalling...', ko: '제거 중...' },
  'st.tts.quality.name': { en: 'Synthesis quality', ko: '합성 품질' },
  'st.tts.quality.desc': {
    en: 'Higher quality = slower synthesis. "Balanced" is recommended.',
    ko: '품질이 높을수록 합성이 느려집니다. "균형"을 권장합니다.',
  },
  'st.tts.quality.fast': { en: 'Fast (lower quality)', ko: '빠름 (낮은 품질)' },
  'st.tts.quality.balanced': { en: 'Balanced (recommended)', ko: '균형 (권장)' },
  'st.tts.quality.high': { en: 'High (slower)', ko: '높음 (느림)' },
  'st.tts.installPath': { en: 'Install path: {path}', ko: '설치 경로: {path}' },
  'st.tts.language.name': { en: 'Language', ko: '언어' },
  'st.tts.language.desc': {
    en: 'Auto-detect or override the speech language',
    ko: '음성 언어를 자동 감지하거나 직접 지정합니다',
  },
  'st.common.autoDetect': { en: 'Auto-detect', ko: '자동 감지' },

  // --- AI comments section ---
  'st.ai.heading': { en: 'AI comments', ko: 'AI 코멘트' },
  'st.ai.mobileNote': {
    en: 'AI comments are only available on desktop (requires local CLI tools)',
    ko: 'AI 코멘트는 데스크톱에서만 사용할 수 있습니다 (로컬 CLI 도구 필요)',
  },
  'st.ai.enable.name': { en: 'Enable AI comments', ko: 'AI 코멘트 활성화' },
  'st.ai.enable.desc': {
    en: 'Show AI comment suggestions on archived posts. Requires local AI CLI tools.',
    ko: '아카이브한 포스트에 AI 코멘트 제안을 표시합니다. 로컬 AI CLI 도구가 필요합니다.',
  },
  'st.ai.defaultTool.name': { en: 'Default AI tool', ko: '기본 AI 도구' },
  'st.ai.defaultTool.desc': {
    en: 'Choose which AI CLI to use by default',
    ko: '기본으로 사용할 AI CLI를 선택합니다',
  },
  'st.ai.notInstalled': { en: '{name} (not installed)', ko: '{name} (설치되지 않음)' },
  'st.ai.commentType.name': { en: 'Default comment type', ko: '기본 코멘트 유형' },
  'st.ai.commentType.desc': {
    en: 'Type of analysis to generate by default',
    ko: '기본으로 생성할 분석 유형입니다',
  },
  'st.ai.outputLang.name': { en: 'Output language', ko: '출력 언어' },
  'st.ai.outputLang.desc': {
    en: 'Language for AI responses. "auto" matches the content language (e.g., Korean content → Korean summary)',
    ko: 'AI 응답 언어입니다. "auto"는 콘텐츠 언어를 따릅니다 (예: 한국어 콘텐츠 → 한국어 요약)',
  },
  'st.ai.tagLang.name': { en: 'Tag language', ko: '태그 언어' },
  'st.ai.tagLang.desc': {
    en: 'Language for AI-suggested tags. "auto" matches the content language (e.g., Korean content → Korean tags)',
    ko: 'AI가 제안하는 태그의 언어입니다. "auto"는 콘텐츠 언어를 따릅니다 (예: 한국어 콘텐츠 → 한국어 태그)',
  },

  // --- Author section ---
  'st.author.heading': { en: 'Author', ko: '작성자' },
  'st.author.avatars.name': { en: 'Download author avatars', ko: '작성자 아바타 다운로드' },
  'st.author.avatars.desc': {
    en: 'Save author profile images locally for offline access. Avatars are stored in the media folder under "authors".',
    ko: '작성자 프로필 이미지를 로컬에 저장해 오프라인에서도 볼 수 있습니다. 아바타는 미디어 폴더의 "authors" 아래에 저장됩니다.',
  },
  'st.author.metadata.name': { en: 'Update author metadata', ko: '작성자 메타데이터 업데이트' },
  'st.author.metadata.desc': {
    en: 'Track author statistics (followers, posts count, bio) on each archive. Useful for author catalog insights.',
    ko: '아카이브할 때마다 작성자 통계(팔로워, 포스트 수, 소개)를 기록합니다. 작성자 카탈로그 분석에 유용합니다.',
  },
  'st.author.overwrite.name': { en: 'Overwrite existing avatars', ko: '기존 아바타 덮어쓰기' },
  'st.author.overwrite.desc': {
    en: 'Replace local avatar file when a new URL is provided. When disabled, existing avatars are preserved.',
    ko: '새 URL이 제공되면 로컬 아바타 파일을 교체합니다. 비활성화하면 기존 아바타를 유지합니다.',
  },
  'st.author.notes.name': { en: 'Enable author notes', ko: '작성자 노트 활성화' },
  'st.author.notes.desc': {
    en: 'Create vault-native markdown files for each author with profile metadata and space for your notes. Experimental feature.',
    ko: '작성자마다 프로필 메타데이터와 메모 공간이 있는 보관함 마크다운 파일을 만듭니다. 실험적 기능입니다.',
  },
  'st.author.notesFolder.name': { en: 'Author notes folder', ko: '작성자 노트 폴더' },
  'st.author.notesFolder.desc': {
    en: 'Folder where author note files will be created. Default: "Social Authors" (outside the archive folder to avoid scanner conflicts).',
    ko: '작성자 노트 파일을 만들 폴더입니다. 기본값: "Social Authors" (스캐너 충돌을 피하기 위해 아카이브 폴더 밖에 둡니다).',
  },
  'st.author.links.name': {
    en: 'Link archive notes to author notes',
    ko: '아카이브 노트를 작성자 노트에 연결',
  },
  'st.author.links.desc': {
    en: 'Add an authorNote wikilink to new archive notes so Obsidian backlinks and graph connections are created automatically.',
    ko: '새 아카이브 노트에 authorNote 위키링크를 추가해 Obsidian 백링크와 그래프 연결이 자동으로 생성되게 합니다.',
  },
  'st.author.alias.name': { en: 'Author link alias', ko: '작성자 링크 별칭' },
  'st.author.alias.desc': {
    en: 'Template used for the visible wikilink label. Click a token to insert it.',
    ko: '위키링크에 표시되는 라벨의 템플릿입니다. 토큰을 클릭하면 삽입됩니다.',
  },
  'st.author.backfill.name': {
    en: 'Apply author links to existing notes',
    ko: '기존 노트에 작성자 링크 적용',
  },
  'st.author.backfill.desc': {
    en: 'Preview and add or update authorNote links across the current archive folder. Other frontmatter and author note bodies are preserved.',
    ko: '현재 아카이브 폴더 전체에서 authorNote 링크를 미리 보고 추가하거나 업데이트합니다. 다른 프론트매터와 작성자 노트 본문은 유지됩니다.',
  },
  'st.common.previewApply': { en: 'Preview & Apply', ko: '미리보기 후 적용' },
  'st.common.scanning': { en: 'Scanning...', ko: '스캔 중...' },
  'st.common.applying': { en: 'Applying...', ko: '적용 중...' },
  'st.author.backfill.confirmTitle': {
    en: 'Apply author links to existing notes?',
    ko: '기존 노트에 작성자 링크를 적용할까요?',
  },
  'st.author.backfill.confirmMessage': {
    en: 'Scanned {scanned} notes and found {authors} authors across {eligible} eligible notes. {missing} author notes will be created if needed.',
    ko: '노트 {scanned}개를 스캔해 대상 노트 {eligible}개에서 작성자 {authors}명을 찾았습니다. 필요 시 작성자 노트 {missing}개가 생성됩니다.',
  },
  'st.author.backfill.confirmButton': { en: 'Apply links', ko: '링크 적용' },
  'st.author.generate.name': { en: 'Generate author notes', ko: '작성자 노트 생성' },
  'st.author.generate.desc': {
    en: 'Scan your vault and create author note files for all discovered authors. Safe to run multiple times.',
    ko: '보관함을 스캔해 발견된 모든 작성자의 노트 파일을 만듭니다. 여러 번 실행해도 안전합니다.',
  },
  'st.author.generate.button': { en: 'Scan & Generate', ko: '스캔 후 생성' },
  'st.author.generate.scanningVault': { en: 'Scanning vault...', ko: '보관함 스캔 중...' },
  'st.author.generate.deduplicating': { en: 'Deduplicating...', ko: '중복 제거 중...' },
  'st.author.generate.processing': {
    en: 'Processing {current}/{total}...',
    ko: '처리 중 {current}/{total}...',
  },
  'st.author.generate.lastScan': {
    en: 'Last scan: {created} created, {updated} updated ({total} authors). Safe to run again.',
    ko: '마지막 스캔: 생성 {created}건, 업데이트 {updated}건 (작성자 {total}명). 다시 실행해도 안전합니다.',
  },

  // --- Transcription section ---
  'st.stt.heading': { en: 'Transcription', ko: '전사' },
  'st.stt.mobileNote': {
    en: 'Transcription is only available on desktop (requires local Whisper CLI)',
    ko: '전사는 데스크톱에서만 사용할 수 있습니다 (로컬 Whisper CLI 필요)',
  },
  'st.stt.enable.name': { en: 'Enable Whisper transcription', ko: 'Whisper 전사 활성화' },
  'st.stt.enable.desc': {
    en: 'Transcribe podcast audio using locally installed Whisper (desktop only)',
    ko: '로컬에 설치된 Whisper로 팟캐스트 오디오를 전사합니다 (데스크톱 전용)',
  },
  'st.stt.variant.name': { en: 'Preferred Whisper variant', ko: '선호 Whisper 구현' },
  'st.stt.variant.descApple': {
    en: 'Choose which Whisper implementation to use. "Auto-detect" tries whisper.cpp first on Apple Silicon (Metal GPU).',
    ko: '사용할 Whisper 구현을 선택합니다. "자동 감지"는 Apple Silicon에서 whisper.cpp를 먼저 시도합니다 (Metal GPU).',
  },
  'st.stt.variant.descOther': {
    en: 'Choose which Whisper implementation to use. "Auto-detect" tries faster-whisper first.',
    ko: '사용할 Whisper 구현을 선택합니다. "자동 감지"는 faster-whisper를 먼저 시도합니다.',
  },
  'st.common.recommendedSuffix': { en: '{name} (recommended)', ko: '{name} (권장)' },
  'st.stt.model.name': { en: 'Preferred model', ko: '선호 모델' },
  'st.stt.model.desc': {
    en: 'Larger models are more accurate but slower. Requires more VRAM.',
    ko: '큰 모델일수록 정확하지만 느립니다. 더 많은 VRAM이 필요합니다.',
  },
  'st.stt.model.tiny': { en: 'Tiny (~1GB VRAM, fastest)', ko: 'Tiny (~1GB VRAM, 가장 빠름)' },
  'st.stt.model.base': { en: 'Base (~1GB VRAM)', ko: 'Base (~1GB VRAM)' },
  'st.stt.model.small': { en: 'Small (~2GB VRAM) - recommended', ko: 'Small (~2GB VRAM) - 권장' },
  'st.stt.model.medium': { en: 'Medium (~5GB VRAM)', ko: 'Medium (~5GB VRAM)' },
  'st.stt.model.large': {
    en: 'Large (~10GB VRAM, most accurate)',
    ko: 'Large (~10GB VRAM, 가장 정확)',
  },
  'st.stt.lang.name': { en: 'Default language', ko: '기본 언어' },
  'st.stt.lang.desc': {
    en: 'Auto-detect or select specific language for transcription',
    ko: '전사 언어를 자동 감지하거나 직접 선택합니다',
  },
  'st.lang.en': { en: 'English', ko: '영어' },
  'st.lang.es': { en: 'Spanish', ko: '스페인어' },
  'st.lang.fr': { en: 'French', ko: '프랑스어' },
  'st.lang.de': { en: 'German', ko: '독일어' },
  'st.lang.it': { en: 'Italian', ko: '이탈리아어' },
  'st.lang.pt': { en: 'Portuguese', ko: '포르투갈어' },
  'st.lang.ja': { en: 'Japanese', ko: '일본어' },
  'st.lang.ko': { en: 'Korean', ko: '한국어' },
  'st.lang.zh': { en: 'Chinese', ko: '중국어' },
  'st.lang.ru': { en: 'Russian', ko: '러시아어' },
  'st.lang.ar': { en: 'Arabic', ko: '아랍어' },
  'st.stt.customPath.name': { en: 'Custom Whisper path', ko: '사용자 지정 Whisper 경로' },
  'st.stt.customPath.desc': {
    en: 'Override automatic detection with a custom binary path (optional)',
    ko: '자동 감지 대신 사용자 지정 바이너리 경로를 사용합니다 (선택 사항)',
  },
  'st.stt.customPath.placeholder': {
    en: '/path/to/whisper or C:\\path\\to\\whisper.exe',
    ko: '/path/to/whisper 또는 C:\\path\\to\\whisper.exe',
  },
  'st.stt.forcePath.name': { en: 'Force enable custom path', ko: '사용자 지정 경로 강제 사용' },
  'st.stt.forcePath.desc': {
    en: 'Skip binary validation when using custom path. Use if detection fails on ARM64, Windows, or other systems.',
    ko: '사용자 지정 경로 사용 시 바이너리 검증을 건너뜁니다. ARM64, Windows 등에서 감지가 실패할 때 사용해 주세요.',
  },
  'st.stt.batchMode.name': { en: 'Batch transcription mode', ko: '일괄 전사 모드' },
  'st.stt.batchMode.desc': {
    en: 'Transcribe-only: transcribe existing local videos. Download-and-transcribe: also download videos from URLs before transcribing.',
    ko: '전사만: 기존 로컬 동영상을 전사합니다. 다운로드 후 전사: 전사 전에 URL에서 동영상도 다운로드합니다.',
  },
  'st.stt.batchMode.transcribeOnly': { en: 'Transcribe only', ko: '전사만' },
  'st.stt.batchMode.downloadAndTranscribe': { en: 'Download & transcribe', ko: '다운로드 후 전사' },
  'st.stt.batch.name': { en: 'Batch transcribe videos in notes', ko: '노트의 동영상 일괄 전사' },
  'st.stt.batch.desc': {
    en: 'Scans notes in your archive folder and transcribes notes with local video attachments where videoTranscribed is not true.',
    ko: '아카이브 폴더의 노트를 스캔해 videoTranscribed가 true가 아닌 로컬 동영상 첨부 노트를 전사합니다.',
  },
  'st.common.start': { en: 'Start', ko: '시작' },
  'st.common.pause': { en: 'Pause', ko: '일시 정지' },
  'st.common.cancel': { en: 'Cancel', ko: '취소' },
  'st.common.resume': { en: 'Resume', ko: '다시 시작' },

  // --- Frontmatter section ---
  'st.fm.heading': { en: 'Frontmatter', ko: '프론트매터' },
  'st.fm.desc': {
    en: 'Choose built-in properties and add custom properties for all archived notes.',
    ko: '모든 아카이브 노트에 적용할 기본 속성을 선택하고 사용자 지정 속성을 추가합니다.',
  },
  'st.fm.enable.name': {
    en: 'Enable frontmatter customization',
    ko: '프론트매터 사용자 지정 활성화',
  },
  'st.fm.enable.desc': {
    en: 'Apply visibility rules and custom properties to newly archived notes.',
    ko: '새로 아카이브하는 노트에 표시 규칙과 사용자 지정 속성을 적용합니다.',
  },
  'st.fm.propertyOrder': { en: 'Property order', ko: '속성 순서' },
  'st.fm.reorderHint': {
    en: 'Reorder rows. Add new rows at the bottom and move them with ↑/↓.',
    ko: '행 순서를 바꿀 수 있습니다. 맨 아래에서 새 행을 추가하고 ↑/↓로 이동해 주세요.',
  },
  'st.fm.cat.authorDetails': { en: 'Author Details', ko: '작성자 상세 정보' },
  'st.fm.cat.engagement': { en: 'Engagement Metrics', ko: '참여 지표' },
  'st.fm.cat.aiAnalysis': { en: 'AI Analysis', ko: 'AI 분석' },
  'st.fm.cat.externalLinks': { en: 'External Links', ko: '외부 링크' },
  'st.fm.cat.externalLinks.desc': {
    en: 'link metadata and linkPreviews',
    ko: '링크 메타데이터와 linkPreviews',
  },
  'st.fm.cat.location': { en: 'Location', ko: '위치' },
  'st.fm.cat.subscription': { en: 'Subscription Info', ko: '구독 정보' },
  'st.fm.cat.seriesInfo': { en: 'Series Info', ko: '시리즈 정보' },
  'st.fm.cat.seriesInfo.desc': {
    en: 'series, episode, genre, rating',
    ko: '시리즈, 에피소드, 장르, 등급',
  },
  'st.fm.cat.podcastInfo': { en: 'Podcast Info', ko: '팟캐스트 정보' },
  'st.fm.cat.podcastInfo.desc': {
    en: 'audio fields, season, hosts, guests',
    ko: '오디오 필드, 시즌, 진행자, 게스트',
  },
  'st.fm.cat.reblogInfo': { en: 'Reblog/Repost', ko: '리블로그/리포스트' },
  'st.fm.cat.reblogInfo.desc': {
    en: 'original author and post references',
    ko: '원본 작성자와 포스트 참조',
  },
  'st.fm.cat.mediaMetadata': { en: 'Media Metadata', ko: '미디어 메타데이터' },
  'st.fm.cat.mediaMetadata.desc': {
    en: 'expired media and processed URLs',
    ko: '만료된 미디어와 처리된 URL',
  },
  'st.fm.cat.workflow': { en: 'Workflow Fields', ko: '워크플로 필드' },
  'st.fm.cat.workflow.desc': {
    en: 'share/archive/video download+transcription status fields',
    ko: '공유/아카이브/동영상 다운로드·전사 상태 필드',
  },
  'st.fm.aliasesSuffix': { en: '{desc} · Aliases: {count}', ko: '{desc} · 별칭: {count}' },
  'st.fm.aliasesButton': { en: 'Aliases ({count})', ko: '별칭 ({count})' },
  'st.fm.aliasButton': { en: 'Alias ({count})', ko: '별칭 ({count})' },
  'st.fm.aliasTooltip': {
    en: 'Edit aliases for keys in this row',
    ko: '이 행의 키 별칭을 편집합니다',
  },
  'st.fm.moveUp': { en: 'Move this row up', ko: '이 행을 위로 이동' },
  'st.fm.moveDown': { en: 'Move this row down', ko: '이 행을 아래로 이동' },
  'st.fm.aliasGuide': {
    en: 'Rename default keys used by this row. Leave empty to keep the original key.',
    ko: '이 행에서 사용하는 기본 키의 이름을 바꿉니다. 비워 두면 원래 키를 유지합니다.',
  },
  'st.fm.aliasPlaceholder': { en: 'alias for {field}', ko: '{field}의 별칭' },
  'st.fm.untitled': { en: 'Untitled', ko: '제목 없음' },
  'st.fm.selectExistingKey': { en: 'Select existing key...', ko: '기존 키 선택...' },
  'st.fm.newKey': { en: 'New key...', ko: '새 키...' },
  'st.fm.type.text': { en: 'Text', ko: '텍스트' },
  'st.fm.type.number': { en: 'Number', ko: '숫자' },
  'st.fm.type.checkbox': { en: 'Checkbox', ko: '체크박스' },
  'st.fm.type.date': { en: 'Date', ko: '날짜' },
  'st.fm.type.dateTime': { en: 'Date & time', ko: '날짜 및 시간' },
  'st.fm.type.list': { en: 'List', ko: '목록' },
  'st.fm.removeProperty': { en: 'Remove property', ko: '속성 제거' },
  'st.fm.addRow.name': { en: 'Add row', ko: '행 추가' },
  'st.fm.addRow.button': { en: '+ add row', ko: '+ 행 추가' },
  'st.fm.value.checkbox.name': { en: 'Checkbox value', ko: '체크박스 값' },
  'st.fm.value.checkbox.desc': {
    en: 'Template override has priority. If empty, checkbox value is used.',
    ko: '템플릿 재정의가 우선합니다. 비어 있으면 체크박스 값이 사용됩니다.',
  },
  'st.fm.value.templatePlatform': {
    en: 'Optional template override, e.g. {{platform}}',
    ko: '선택적 템플릿 재정의, 예: {{platform}}',
  },
  'st.fm.value.date.name': { en: 'Date value', ko: '날짜 값' },
  'st.fm.value.date.desc': {
    en: 'Template override has priority. If empty, date picker value is used.',
    ko: '템플릿 재정의가 우선합니다. 비어 있으면 날짜 선택기 값이 사용됩니다.',
  },
  'st.fm.value.templateDates': {
    en: 'Optional template override, e.g. {{dates.archived}}',
    ko: '선택적 템플릿 재정의, 예: {{dates.archived}}',
  },
  'st.fm.value.dateTime.name': { en: 'Date & time value', ko: '날짜 및 시간 값' },
  'st.fm.value.dateTime.desc': {
    en: 'Template override has priority. If empty, date-time picker value is used.',
    ko: '템플릿 재정의가 우선합니다. 비어 있으면 날짜-시간 선택기 값이 사용됩니다.',
  },
  'st.fm.value.list.name': { en: 'List value', ko: '목록 값' },
  'st.fm.value.list.desc': {
    en: 'One item per line. Template variables are supported in each line.',
    ko: '한 줄에 한 항목씩 입력합니다. 각 줄에서 템플릿 변수를 사용할 수 있습니다.',
  },
  'st.fm.value.list.placeholder': {
    en: 'first item\nsecond item\n{{platform}}',
    ko: '첫 번째 항목\n두 번째 항목\n{{platform}}',
  },
  'st.fm.value.number.name': { en: 'Number Value', ko: '숫자 값' },
  'st.fm.value.text.name': { en: 'Text Value', ko: '텍스트 값' },
  'st.fm.value.simple.desc': {
    en: 'Template variables are supported.',
    ko: '템플릿 변수를 사용할 수 있습니다.',
  },
  'st.fm.value.number.placeholder': { en: '123 or {{post.id}}', ko: '123 또는 {{post.id}}' },
  'st.fm.value.text.placeholder': { en: 'inbox or {{platform}}', ko: 'inbox 또는 {{platform}}' },
  'st.fm.variablesNote': {
    en: 'Custom property values support these template variables: {{platform}}, {{author.name}}, {{author.handle}}, {{author.username}}, {{author.url}}, {{post.id}}, {{post.url}}, {{dates.published}}, {{dates.archived}}, {{dates.lastModified}}. Use the dotted form exactly (e.g. {{post.url}}), not the property label. ',
    ko: '사용자 지정 속성 값에서 다음 템플릿 변수를 사용할 수 있습니다: {{platform}}, {{author.name}}, {{author.handle}}, {{author.username}}, {{author.url}}, {{post.id}}, {{post.url}}, {{dates.published}}, {{dates.archived}}, {{dates.lastModified}}. 속성 라벨이 아니라 점 표기 형식을 그대로 사용해 주세요 (예: {{post.url}}). ',
  },
  'st.fm.viewGuide': { en: 'View guide', ko: '가이드 보기' },
  'st.fm.coreLockedNote': {
    en: 'Core keys cannot be removed, renamed, or replaced by a custom property with the same name: platform, author, authorUrl, authorNote, published, archived, lastModified, tags, archiveTags.',
    ko: '핵심 키는 제거하거나 이름을 바꾸거나 같은 이름의 사용자 지정 속성으로 대체할 수 없습니다: platform, author, authorUrl, authorNote, published, archived, lastModified, tags, archiveTags.',
  },
  'st.fm.archiveTags': { en: 'Archive tags', ko: '아카이브 태그' },
  'st.fm.mainTag.name': { en: 'Main archive tag', ko: '메인 아카이브 태그' },
  'st.fm.mainTag.desc': {
    en: 'Base tag for archived notes. Example: maintag or #maintag. Leave empty to disable auto tags.',
    ko: '아카이브 노트의 기본 태그입니다. 예: maintag 또는 #maintag. 비워 두면 자동 태그가 비활성화됩니다.',
  },
  'st.fm.tagStructure.name': { en: 'Tag structure', ko: '태그 구조' },
  'st.fm.tagStructure.desc': {
    en: 'Choose how the auto tag is generated from the main tag.',
    ko: '메인 태그에서 자동 태그를 어떻게 생성할지 선택합니다.',
  },
  'st.fm.applyMainTag.name': {
    en: 'Apply main tag to existing notes',
    ko: '기존 노트에 메인 태그 적용',
  },
  'st.fm.applyMainTag.desc': {
    en: 'Preview and replace only known plugin-managed main tags in the current archive folder. Unrelated tags and archiveTags are preserved.',
    ko: '현재 아카이브 폴더에서 플러그인이 관리하는 것으로 확인된 메인 태그만 미리 보고 교체합니다. 무관한 태그와 archiveTags는 유지됩니다.',
  },
  'st.fm.applyMainTag.confirmTitle': {
    en: 'Apply main tag to existing notes?',
    ko: '기존 노트에 메인 태그를 적용할까요?',
  },
  'st.fm.applyMainTag.confirmMessage': {
    en: 'Scanned {scanned} notes. {updated} will change, {unchanged} are already current, and {skipped} will be skipped.',
    ko: '노트 {scanned}개를 스캔했습니다. {updated}개가 변경되고, {unchanged}개는 이미 최신이며, {skipped}개는 건너뜁니다.',
  },
  'st.fm.applyMainTag.confirmButton': { en: 'Apply tag rule', ko: '태그 규칙 적용' },
  'st.fm.mirror.name': {
    en: 'Mirror archive tags to Obsidian tags',
    ko: '아카이브 태그를 Obsidian 태그에 미러링',
  },
  'st.fm.mirror.desc': {
    en: 'Also write Social Archiver archive tags into the native frontmatter tags field. Existing Obsidian tags are preserved.',
    ko: 'Social Archiver 아카이브 태그를 기본 프론트매터 tags 필드에도 기록합니다. 기존 Obsidian 태그는 유지됩니다.',
  },
  'st.fm.reset.name': { en: 'Reset frontmatter settings', ko: '프론트매터 설정 재설정' },
  'st.fm.reset.desc': {
    en: 'Reset property order, custom rows, visibility toggles, and archive tag settings.',
    ko: '속성 순서, 사용자 지정 행, 표시 토글, 아카이브 태그 설정을 재설정합니다.',
  },
  'st.fm.reset.button': { en: 'Reset all', ko: '전체 재설정' },

  // --- Whisper status panel ---
  'st.whisper.mobileOnly': {
    en: 'ⓘ transcription is only available on desktop',
    ko: 'ⓘ 전사는 데스크톱에서만 사용할 수 있습니다',
  },
  'st.whisper.detecting': {
    en: 'Detecting Whisper installation...',
    ko: 'Whisper 설치를 감지하는 중...',
  },
  'st.whisper.detected': { en: '✓ Detected: {variant}', ko: '✓ 감지됨: {variant}' },
  'st.whisper.customPathSuffix': { en: ' (custom path)', ko: ' (사용자 지정 경로)' },
  'st.whisper.path': { en: '  Path: {path}', ko: '  경로: {path}' },
  'st.whisper.version': { en: '  Version: {version}', ko: '  버전: {version}' },
  'st.whisper.models': { en: '  Models: {models}', ko: '  모델: {models}' },
  'st.whisper.notDetected': { en: '✗ Whisper not detected', ko: '✗ Whisper가 감지되지 않았습니다' },
  'st.whisper.customPathInvalid': {
    en: '⚠ Custom path could not be validated: {path}',
    ko: '⚠ 사용자 지정 경로를 확인할 수 없습니다: {path}',
  },
  'st.whisper.verifyHint': {
    en: 'Please verify the file exists and is a valid Whisper binary.',
    ko: '파일이 존재하고 올바른 Whisper 바이너리인지 확인해 주세요.',
  },
  'st.whisper.installHint': {
    en: 'Install faster-whisper: pip install faster-whisper',
    ko: 'faster-whisper 설치: pip install faster-whisper',
  },
  'st.whisper.detectError': { en: '⚠ Could not detect Whisper', ko: '⚠ Whisper를 감지할 수 없습니다' },

  // --- Reddit sync section (parked until API approval) ---
  'st.reddit.heading': { en: 'Reddit sync', ko: 'Reddit 동기화' },
  'st.reddit.desc': {
    en: 'Automatically sync your Reddit saved posts to your vault. Requires connecting your Reddit account.',
    ko: 'Reddit에 저장한 포스트를 보관함에 자동으로 동기화합니다. Reddit 계정 연결이 필요합니다.',
  },
  'st.reddit.account.name': { en: 'Reddit account', ko: 'Reddit 계정' },
  'st.reddit.connectedAs': { en: 'Connected as u/{username}', ko: 'u/{username}(으)로 연결됨' },
  'st.reddit.connectDesc': {
    en: 'Connect your Reddit account to enable sync',
    ko: '동기화를 사용하려면 Reddit 계정을 연결해 주세요',
  },
  'st.reddit.disconnect': { en: 'Disconnect', ko: '연결 해제' },
  'st.reddit.connect': { en: 'Connect Reddit', ko: 'Reddit 연결' },
  'st.reddit.autoSync.name': { en: 'Enable automatic sync', ko: '자동 동기화 활성화' },
  'st.reddit.autoSync.desc': {
    en: 'Automatically sync saved posts on a schedule',
    ko: '일정에 따라 저장한 포스트를 자동으로 동기화합니다',
  },
  'st.reddit.folder.name': { en: 'Sync folder', ko: '동기화 폴더' },
  'st.reddit.folder.desc': {
    en: 'Folder where synced Reddit posts will be saved',
    ko: '동기화한 Reddit 포스트를 저장할 폴더입니다',
  },
  'st.reddit.syncNow.name': { en: 'Sync now', ko: '지금 동기화' },
  'st.reddit.syncNow.desc': {
    en: 'Manually trigger a sync of your Reddit saved posts',
    ko: 'Reddit에 저장한 포스트의 동기화를 직접 실행합니다',
  },
  'st.reddit.syncing': { en: 'Syncing...', ko: '동기화 중...' },
  'st.reddit.about': { en: 'About Reddit sync', ko: 'Reddit 동기화 안내' },
  'st.reddit.about.li1': {
    en: "Syncs posts you've saved on Reddit",
    ko: 'Reddit에 저장한 포스트를 동기화합니다',
  },
  'st.reddit.about.li2': {
    en: 'Requires Reddit OAuth authentication',
    ko: 'Reddit OAuth 인증이 필요합니다',
  },
  'st.reddit.about.li3': {
    en: 'Runs automatically once per day when enabled',
    ko: '활성화하면 하루에 한 번 자동으로 실행됩니다',
  },
  'st.reddit.about.li4': {
    en: 'Only new saved posts are synced (deduplication)',
    ko: '새로 저장한 포스트만 동기화됩니다 (중복 제거)',
  },
  'st.reddit.status.connectedPrefix': { en: 'Connected as ', ko: '연결된 계정: ' },
  'st.reddit.status.notConnected': { en: 'Not connected', ko: '연결되지 않음' },

  // --- AI tools status panel ---
  'st.ai.detecting': { en: 'Detecting AI tools...', ko: 'AI 도구를 감지하는 중...' },
  'st.ai.installTooltip': {
    en: 'Click to learn how to install {name}',
    ko: '{name} 설치 방법을 보려면 클릭하세요',
  },
  'st.ai.refresh': { en: 'Refresh detection', ko: '다시 감지' },
  'st.ai.detectError': { en: '⚠ could not detect AI tools', ko: '⚠ AI 도구를 감지할 수 없습니다' },

  // --- Platform visibility (collapsible) ---
  'st.ai.pv.collapsed': { en: '▶ Platform visibility', ko: '▶ 플랫폼 표시' },
  'st.ai.pv.expanded': { en: '▼ Platform visibility', ko: '▼ 플랫폼 표시' },
  'st.ai.pv.desc': {
    en: 'Choose which platform types show AI comment banners',
    ko: 'AI 코멘트 배너를 표시할 플랫폼 유형을 선택합니다',
  },
  'st.ai.pv.social': { en: 'Social media', ko: '소셜 미디어' },
  'st.ai.pv.blog': { en: 'Blog & news', ko: '블로그 및 뉴스' },
  'st.ai.pv.video': { en: 'Video & audio', ko: '동영상 및 오디오' },
  'st.ai.pv.excluded': { en: 'Excluded platforms', ko: '제외할 플랫폼' },

  // --- Vault context (collapsible) ---
  'st.ai.vc.collapsed': { en: '▶ Vault context (connections)', ko: '▶ 보관함 컨텍스트 (연결)' },
  'st.ai.vc.expanded': { en: '▼ Vault context (connections)', ko: '▼ 보관함 컨텍스트 (연결)' },
  'st.ai.vc.desc': {
    en: 'Configure how AI finds connections to your notes',
    ko: 'AI가 내 노트와의 연결을 찾는 방식을 설정합니다',
  },
  'st.ai.vc.enable.name': { en: 'Enable vault context', ko: '보관함 컨텍스트 활성화' },
  'st.ai.vc.enable.desc': {
    en: 'Allow AI to scan your vault for related notes when using "connections" comment type',
    ko: '"connections" 코멘트 유형 사용 시 AI가 관련 노트를 찾기 위해 보관함을 스캔하도록 허용합니다',
  },
  'st.ai.vc.smart.name': { en: 'Smart filtering', ko: '스마트 필터링' },
  'st.ai.vc.smart.desc': {
    en: 'Use keyword matching to select only relevant notes for context',
    ko: '키워드 매칭으로 관련 있는 노트만 컨텍스트에 포함합니다',
  },
  'st.ai.vc.maxNotes.name': { en: 'Max context notes', ko: '최대 컨텍스트 노트 수' },
  'st.ai.vc.maxNotes.desc': {
    en: 'Maximum number of notes to include in AI context',
    ko: 'AI 컨텍스트에 포함할 노트의 최대 개수입니다',
  },
  'st.ai.vc.exclude.name': { en: 'Exclude folders', ko: '폴더 제외' },
  'st.ai.vc.exclude.desc': {
    en: 'Select folders to exclude from context scanning',
    ko: '컨텍스트 스캔에서 제외할 폴더를 선택합니다',
  },
  'st.ai.vc.selectFolder': { en: 'Select folder...', ko: '폴더 선택...' },
} satisfies Record<string, LocaleText>;
