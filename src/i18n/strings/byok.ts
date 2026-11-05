/**
 * AI with the user's own API key (BYOK): settings, consent, engine label,
 * provider errors. Key prefix "byok.". Every entry is { en, ko }.
 * Engines are named by provider ("OpenAI (my key)"), never "local".
 */
import type { LocaleText } from '../index';

export const byokStrings = {
  'byok.engineLabel': { en: '{provider} (my key)', ko: '{provider} (내 키)' },
  'byok.unsupported': {
    en: 'Your own API keys need Obsidian 1.11.4 or later (secure secret storage).',
    ko: '내 API 키를 쓰려면 Obsidian 1.11.4 이상이 필요해요(안전한 비밀 저장소).',
  },
  'byok.modelReplaced': {
    en: '{old} was retired by {provider}; now using {new}.',
    ko: '{provider}에서 {old} 모델을 종료해 이제 {new} 모델을 사용해요.',
  },

  // Settings
  'byok.settings.heading': { en: 'AI API keys', ko: 'AI API 키' },
  'byok.settings.desc': {
    en: 'Use AI with your own OpenAI, Anthropic, Gemini or OpenRouter key: AI comments now, chat and research on archived posts. Requests go straight from this device to the provider and are billed to your account. Keys stay in Obsidian’s secret storage on this device and never reach Social Archiver.',
    ko: '내 OpenAI, Anthropic, Gemini, OpenRouter 키로 AI를 사용하세요. 보관한 글에 AI 코멘트, 채팅, 리서치를 쓸 수 있어요. 요청은 이 기기에서 제공업체로 바로 가고 내 계정에 청구돼요. 키는 이 기기의 Obsidian 비밀 저장소에만 있고 Social Archiver로 전송되지 않아요.',
  },
  'byok.settings.keyHint': {
    en: 'Paste your {provider} API key ({prefix}…).',
    ko: '{provider} API 키({prefix}…)를 붙여넣으세요.',
  },
  'byok.settings.addKey': { en: 'Add key…', ko: '키 추가…' },
  'byok.settings.replaceKey': { en: 'Replace key…', ko: '키 교체…' },
  'byok.settings.useSaved': {
    en: 'Use a key already saved in Obsidian…',
    ko: 'Obsidian에 이미 저장된 키 사용…',
  },
  'byok.settings.linkedSecret': {
    en: 'Using the key saved in Obsidian as “{name}”.',
    ko: 'Obsidian에 “{name}”(으)로 저장된 키를 쓰고 있어요.',
  },
  'byok.keyModal.title': { en: '{provider} API key', ko: '{provider} API 키' },
  'byok.keyModal.desc': {
    en: 'Paste the API key from your {provider} account. It is kept in Obsidian’s secret storage on this device and never sent to Social Archiver.',
    ko: '{provider} 계정에서 발급한 API 키를 붙여넣으세요. 키는 이 기기의 Obsidian 비밀 저장소에만 보관되고 Social Archiver로 전송되지 않아요.',
  },
  'byok.keyModal.empty': { en: 'Paste a key first.', ko: '먼저 키를 붙여넣으세요.' },
  'byok.keyModal.save': { en: 'Save', ko: '저장' },
  'byok.keyModal.cancel': { en: 'Cancel', ko: '취소' },
  'byok.secretPicker.placeholder': {
    en: 'Choose a key saved in Obsidian…',
    ko: 'Obsidian에 저장된 키 선택…',
  },
  'byok.secretPicker.empty': { en: 'No saved keys match.', ko: '일치하는 저장된 키가 없어요.' },
  'byok.settings.status.notSet': { en: 'No key on this device.', ko: '이 기기에 키가 없어요.' },
  'byok.settings.status.unchecked': { en: 'Key saved ({fingerprint}), not checked yet.', ko: '키 저장됨({fingerprint}), 아직 확인 전이에요.' },
  'byok.settings.status.valid': { en: 'Key works ({fingerprint}).', ko: '키가 정상이에요({fingerprint}).' },
  'byok.settings.status.validFree': {
    en: 'Key works ({fingerprint}), free tier.',
    ko: '키가 정상이에요({fingerprint}). 무료 등급이에요.',
  },
  'byok.settings.status.failed': { en: '{reason} ({fingerprint})', ko: '{reason} ({fingerprint})' },
  'byok.settings.status.checking': { en: 'Checking the key…', ko: '키를 확인하는 중…' },
  'byok.settings.status.checkFailed': { en: 'The key check failed.', ko: '키를 확인하지 못했어요.' },
  'byok.settings.test': { en: 'Test key', ko: '키 확인' },
  'byok.settings.remove': { en: 'Remove key', ko: '키 삭제' },
  'byok.settings.removeConfirm': {
    en: 'Remove the {provider} key from this device?',
    ko: '이 기기에서 {provider} 키를 삭제할까요?',
  },
  'byok.settings.enable': { en: 'Use on this device', ko: '이 기기에서 사용' },
  'byok.settings.model.name': { en: '{provider} model', ko: '{provider} 모델' },
  'byok.settings.model.desc': {
    en: 'Used for comments and chat. Research uses a model with web search when this one has none.',
    ko: '코멘트와 채팅에 써요. 이 모델에 웹 검색이 없으면 리서치는 웹 검색 모델을 써요.',
  },
  'byok.settings.model.recommended': { en: 'Recommended', ko: '추천' },
  'byok.settings.model.recommendedNamed': { en: 'Recommended ({model})', ko: '추천({model})' },
  'byok.settings.model.retires': {
    en: '{model} retires on {date}. Switch to {replacement}?',
    ko: '{model} 모델은 {date}에 종료돼요. {replacement}(으)로 바꿀까요?',
  },
  'byok.settings.model.retired': {
    en: '{model} was retired by {provider}. Runs use {replacement} instead.',
    ko: '{provider}에서 {model} 모델을 종료했어요. 대신 {replacement} 모델을 써요.',
  },
  'byok.settings.model.switch': { en: 'Switch', ko: '바꾸기' },
  'byok.settings.model.loadFailed': {
    en: 'Could not load the model list. Test the key first.',
    ko: '모델 목록을 불러오지 못했어요. 먼저 키를 확인하세요.',
  },
  'byok.settings.links.key': { en: 'Get a key', ko: '키 발급' },
  'byok.settings.links.billing': { en: 'Billing', ko: '결제' },
  'byok.settings.links.privacy': { en: 'Privacy', ko: '개인정보' },
  'byok.settings.geminiNote': {
    en: 'On Gemini’s free tier, Google may use your inputs and outputs to improve its products, including human review. In the EEA, the UK and Switzerland a paid tier is required.',
    ko: 'Gemini 무료 등급에서는 Google이 입력과 출력을 제품 개선(사람 검토 포함)에 쓸 수 있어요. EEA, 영국, 스위스에서는 유료 등급이 필요해요.',
  },
  'byok.settings.cliNote': {
    en: 'While the Social Archiver CLI runs AI jobs for this vault, jobs sent from your other devices do not use these keys.',
    ko: 'Social Archiver CLI가 이 보관함의 AI 작업을 실행하는 동안에는 다른 기기에서 보낸 작업에 이 키를 쓰지 않아요.',
  },

  // Consent
  'byok.consent.title': { en: 'Use your {provider} key?', ko: '{provider} 키를 사용할까요?' },
  'byok.consent.intro': {
    en: 'When you run AI with this key, Social Archiver sends the following straight from this device to {provider}:',
    ko: '이 키로 AI를 실행하면 Social Archiver가 다음 내용을 이 기기에서 {provider}(으)로 바로 보내요.',
  },
  'byok.consent.itemContent': {
    en: 'The post’s text, its transcript and text read from its images',
    ko: '글 본문, 대본, 이미지에서 읽은 텍스트',
  },
  'byok.consent.itemQuestion': { en: 'Your questions and instructions', ko: '내 질문과 요청' },
  'byok.consent.billing': {
    en: '{provider} bills your own account for these requests.',
    ko: '이 요청은 {provider}에서 내 계정으로 청구해요.',
  },
  'byok.consent.key': {
    en: 'Your key stays on this device. Social Archiver never sees it.',
    ko: '키는 이 기기에만 있어요. Social Archiver는 키를 볼 수 없어요.',
  },
  'byok.consent.privacy': { en: '{provider} privacy policy', ko: '{provider} 개인정보 처리방침' },
  'byok.consent.accept': { en: 'Allow', ko: '허용' },
  'byok.consent.cancel': { en: 'Cancel', ko: '취소' },

  // Provider errors (by ByokErrorCode)
  'byok.error.invalidKey': {
    en: '{provider} rejected the key. Check it in Social Archiver settings.',
    ko: '{provider}에서 키를 거부했어요. Social Archiver 설정에서 키를 확인하세요.',
  },
  'byok.error.insufficientCredit': {
    en: 'Your {provider} account has no credit or quota left.',
    ko: '{provider} 계정에 남은 크레딧이나 한도가 없어요.',
  },
  'byok.error.rateLimited': {
    en: '{provider} is rate limiting requests. Try again shortly.',
    ko: '{provider}에서 요청 속도를 제한하고 있어요. 잠시 후 다시 시도하세요.',
  },
  'byok.error.rateLimitedRetry': {
    en: '{provider} is rate limiting requests. Try again in {seconds} s.',
    ko: '{provider}에서 요청 속도를 제한하고 있어요. {seconds}초 후 다시 시도하세요.',
  },
  'byok.error.modelNotFound': {
    en: 'No {provider} model fits this task. Choose one in Social Archiver settings.',
    ko: '이 작업에 맞는 {provider} 모델이 없어요. Social Archiver 설정에서 모델을 고르세요.',
  },
  'byok.error.regionBlocked': {
    en: '{provider} is not available in your region.',
    ko: '내 지역에서는 {provider}를 사용할 수 없어요.',
  },
  'byok.error.contentBlocked': {
    en: '{provider} declined this request.',
    ko: '{provider}에서 이 요청을 거절했어요.',
  },
  'byok.error.contextTooLong': {
    en: 'This post is too long for the {provider} model.',
    ko: '이 글은 {provider} 모델이 처리하기에 너무 길어요.',
  },
  'byok.error.unavailable': {
    en: '{provider} is not responding. Try again later.',
    ko: '{provider}가 응답하지 않아요. 나중에 다시 시도하세요.',
  },
  'byok.error.network': {
    en: 'Could not reach {provider}. Check your connection.',
    ko: '{provider}에 연결할 수 없어요. 인터넷 연결을 확인하세요.',
  },
  'byok.error.networkKeyHint': {
    en: 'Could not reach {provider}. If you are online, the key may be invalid.',
    ko: '{provider}에 연결할 수 없어요. 인터넷이 연결되어 있다면 키가 잘못됐을 수 있어요.',
  },
  'byok.error.cancelled': { en: 'The {provider} request was cancelled.', ko: '{provider} 요청을 취소했어요.' },
  'byok.error.unknown': { en: '{provider} failed: {message}', ko: '{provider} 오류: {message}' },

  // Entry points (post card AI menu, reader AI menu)
  'byok.menu.button': { en: 'AI chat and research', ko: 'AI 채팅·리서치' },
  'byok.menu.chat': { en: 'Chat about this post', ko: '이 글에 대해 채팅' },
  'byok.menu.research': { en: 'Research this post', ko: '이 글 리서치' },
  'byok.menu.addKey': { en: 'Chat and research: add an API key', ko: '채팅·리서치: API 키 추가' },
  'byok.menu.addKeyResearch': { en: 'Research: add your own API key', ko: '리서치: 내 API 키 추가' },
  'byok.openSettings': { en: 'Open settings', ko: '설정 열기' },
  'byok.noRoom': {
    en: 'This note has too much AI comment text. Delete some AI comments and try again.',
    ko: '이 노트에 AI 코멘트가 너무 많아요. 일부를 삭제한 뒤 다시 시도하세요.',
  },
  'byok.saveFailed': { en: 'Could not save to the note: {reason}', ko: '노트에 저장하지 못했어요: {reason}' },

  // Chat
  'byok.chat.title': { en: 'Chat about this post', ko: '이 글에 대해 채팅' },
  'byok.chat.dock.close': { en: 'Close chat', ko: '채팅 닫기' },
  'byok.chat.dock.resize': { en: 'Expand or shrink the chat', ko: '채팅 창 크기 바꾸기' },
  'byok.chat.dock.noNote': {
    en: 'This post has no note to save a chat to.',
    ko: '이 글에는 채팅을 저장할 노트가 없어요.',
  },
  'byok.chat.engine': { en: 'Engine', ko: '엔진' },
  'byok.chat.engineLocked': { en: 'Start a new chat to switch engines.', ko: '엔진을 바꾸려면 새 채팅을 시작하세요.' },
  'byok.chat.newChat': { en: 'New chat', ko: '새 채팅' },
  'byok.chat.empty': {
    en: 'Ask anything about this post. Answers draw on its text, transcript and the text in its images.',
    ko: '이 글에 대해 무엇이든 물어보세요. 본문, 대본, 이미지 속 텍스트를 바탕으로 답해요.',
  },
  'byok.chat.placeholder': { en: 'Ask about this post…', ko: '이 글에 대해 질문하세요…' },
  'byok.chat.send': { en: 'Send', ko: '보내기' },
  'byok.chat.stop': { en: 'Stop', ko: '중지' },
  'byok.chat.thinking': { en: 'Thinking…', ko: '생각하는 중…' },
  'byok.chat.save': { en: 'Save to note', ko: '노트에 저장' },
  'byok.chat.saved': { en: 'Chat saved to the note.', ko: '채팅을 노트에 저장했어요.' },
  'byok.chat.savedTrimmed': {
    en: 'Chat saved to the note without its oldest {count} question(s), which did not fit.',
    ko: '용량이 넘친 오래된 질문 {count}개를 빼고 채팅을 노트에 저장했어요.',
  },
  'byok.chat.turnLimit': {
    en: 'This chat reached {max} questions. Save it or start a new chat.',
    ko: '질문이 {max}개에 도달했어요. 저장하거나 새 채팅을 시작하세요.',
  },
  'byok.chat.cloudCredits': { en: '{credits} Cloud AI credits per question.', ko: '질문마다 Cloud AI 크레딧 {credits}개를 써요.' },
  'byok.chat.web': { en: 'Search the web for the next question', ko: '다음 질문에 웹 검색 사용' },
  'byok.chat.noEngine': {
    en: 'To chat about posts, add an AI API key in Social Archiver settings, or sign in to use Cloud AI on synced posts.',
    ko: '글에 대해 채팅하려면 Social Archiver 설정에서 AI API 키를 추가하거나, 로그인해 동기화된 글에서 Cloud AI를 사용하세요.',
  },
  'byok.chat.discardTitle': { en: 'Discard this chat?', ko: '이 채팅을 버릴까요?' },
  'byok.chat.discardMessage': { en: 'It is not saved to the note yet.', ko: '아직 노트에 저장하지 않았어요.' },
  'byok.chat.discard': { en: 'Discard', ko: '버리기' },
  'byok.chat.continueSaved': { en: 'Continue chat', ko: '이어서 채팅하기' },
  'byok.chat.continueDiscardTitle': { en: 'Continue this saved chat?', ko: '저장된 채팅을 이어갈까요?' },
  'byok.chat.continueDiscardMessage': {
    en: "The chat you haven't saved to the note will be discarded.",
    ko: '노트에 저장하지 않은 채팅은 사라져요.',
  },
  'byok.chat.keep': { en: 'Keep chatting', ko: '계속하기' },
  // The reader's floating button back to a chat put down on the post.
  'byok.chat.resume': { en: 'AI chat', ko: 'AI 채팅' },

  // "@Claude …" in the note: the picker, why an AI cannot answer, who is answering
  'byok.mention.picker': { en: 'Ask an AI', ko: 'AI에게 묻기' },
  'byok.mention.noKey': {
    en: 'Add your {provider} key in Social Archiver settings to ask @{handle}.',
    ko: '@{handle}에게 물어보려면 Social Archiver 설정에서 {provider} 키를 추가하세요.',
  },
  'byok.mention.signIn': {
    en: 'Sign in to Social Archiver to ask @{handle}.',
    ko: '@{handle}에게 물어보려면 Social Archiver에 로그인하세요.',
  },
  'byok.mention.replying': { en: '{name} is replying…', ko: '{name} 답변 작성 중…' },

  // Web access the user turns on for one request (chat question, custom AI comment)
  'byok.web.comment': { en: 'Search the web', ko: '웹 검색' },
  'byok.web.cost': {
    en: 'Web searches may cost extra on your {provider} account.',
    ko: '웹 검색은 내 {provider} 계정에 추가 요금이 청구될 수 있어요.',
  },
  'byok.web.unsupported': { en: '{model} cannot search the web.', ko: '{model} 모델은 웹 검색을 할 수 없어요.' },

  // Cloud AI chat errors (server codes)
  'byok.cloud.consentRequired': {
    en: 'Cloud AI is off for this account. Turn it on in the Social Archiver app, or use your own API key.',
    ko: '이 계정은 Cloud AI가 꺼져 있어요. Social Archiver 앱에서 켜거나 내 API 키를 사용하세요.',
  },
  'byok.cloud.localOnly': {
    en: 'This account keeps posts away from Cloud AI. Use your own API key instead.',
    ko: '이 계정은 Cloud AI를 쓰지 않도록 설정되어 있어요. 내 API 키를 사용하세요.',
  },
  'byok.cloud.credits': {
    en: 'Not enough Cloud AI credits. Upgrade or restore in the Social Archiver mobile app with the same account, or use your own API key.',
    ko: 'Cloud AI 크레딧이 부족해요. 같은 계정으로 Social Archiver 모바일 앱에서 업그레이드하거나 복원하세요. 내 API 키를 써도 돼요.',
  },
  'byok.cloud.rateLimited': {
    en: 'Too many Cloud AI questions. Try again in a minute.',
    ko: 'Cloud AI 질문이 너무 많아요. 1분 뒤 다시 시도하세요.',
  },
  'byok.cloud.unsupported': { en: 'This post has too little text to chat about.', ko: '이 글은 채팅할 텍스트가 너무 적어요.' },
  'byok.cloud.notFound': {
    en: 'This post is not on the server yet. Try again after it syncs, or use your own API key.',
    ko: '이 글이 아직 서버에 없어요. 동기화된 뒤 다시 시도하거나 내 API 키를 사용하세요.',
  },
  'byok.cloud.failed': { en: 'Cloud AI could not answer. Try again later.', ko: 'Cloud AI가 답하지 못했어요. 나중에 다시 시도하세요.' },

  // Research
  'byok.research.title': { en: 'Research this post', ko: '이 글 리서치' },
  'byok.research.intro': {
    en: 'A report checked against the web: background, a claim-by-claim check, related reading and sources. It is saved with the note’s AI comments.',
    ko: '웹에서 확인한 리포트예요. 배경, 주장별 확인, 관련 자료, 출처를 담아 노트의 AI 코멘트에 저장해요.',
  },
  'byok.research.engine': { en: 'Engine', ko: '엔진' },
  'byok.research.depth': { en: 'Depth', ko: '깊이' },
  'byok.research.quick': { en: 'Quick', ko: '빠르게' },
  'byok.research.quickDesc': { en: 'One pass, about 30 seconds to 2 minutes.', ko: '한 번에 실행해요. 약 30초~2분 걸려요.' },
  'byok.research.deep': { en: 'Deep', ko: '심층' },
  'byok.research.deepDesc': {
    en: 'A background job on {provider} that can take up to an hour. You get a notice when it is saved.',
    ko: '{provider}에서 백그라운드로 실행해 최대 1시간 걸릴 수 있어요. 저장되면 알려 드려요.',
  },
  'byok.research.deepUnavailable': {
    en: 'Deep research needs an OpenAI or Gemini key.',
    ko: '심층 리서치는 OpenAI 또는 Gemini 키가 필요해요.',
  },
  'byok.research.focus': { en: 'Focus (optional)', ko: '초점(선택)' },
  'byok.research.focusPlaceholder': {
    en: 'For example: check the figures in the second half',
    ko: '예: 후반부 수치가 맞는지 확인',
  },
  'byok.research.run': { en: 'Run research', ko: '리서치 실행' },
  'byok.research.running': { en: 'Researching with {engine}…', ko: '{engine}(으)로 리서치하는 중…' },
  'byok.research.backgroundHint': {
    en: 'You can close this window: the report is saved to the note when it is ready.',
    ko: '이 창을 닫아도 돼요. 리포트가 준비되면 노트에 저장해요.',
  },
  'byok.research.cancel': { en: 'Cancel', ko: '취소' },
  'byok.research.saved': { en: 'Research saved to the note.', ko: '리서치를 노트에 저장했어요.' },
  'byok.research.failed': { en: 'Research failed: {reason}', ko: '리서치 실패: {reason}' },
  'byok.research.deepStarted': {
    en: 'Deep research started on {provider}. It can take up to an hour; you get a notice when it is saved.',
    ko: '{provider}에서 심층 리서치를 시작했어요. 최대 1시간 걸릴 수 있고, 저장되면 알려 드려요.',
  },
  'byok.research.deepRunning': {
    en: 'Deep research is already running for this post.',
    ko: '이 글의 심층 리서치가 이미 진행 중이에요.',
  },
  'byok.research.deepSaved': { en: 'Deep research saved to “{note}”.', ko: '심층 리서치를 “{note}”에 저장했어요.' },
  'byok.research.deepFailed': { en: 'Deep research on “{note}” failed: {reason}', ko: '“{note}” 심층 리서치 실패: {reason}' },
  'byok.research.deepTimedOut': {
    en: 'Deep research on “{note}” ran for over an hour and was stopped.',
    ko: '“{note}” 심층 리서치가 1시간을 넘겨 중단했어요.',
  },
  'byok.research.deepNoRoom': {
    en: 'Deep research on “{note}” is ready, but the note has too much AI comment text. Delete some AI comments, then try again.',
    ko: '“{note}” 심층 리서치가 끝났지만 노트에 AI 코멘트가 너무 많아요. 일부를 삭제한 뒤 다시 시도하세요.',
  },
  'byok.research.noteMissing': {
    en: 'Deep research finished, but its note is gone.',
    ko: '심층 리서치가 끝났지만 해당 노트가 없어요.',
  },
  'byok.research.runAgain': { en: 'Run again', ko: '다시 실행' },
  'byok.research.tryAgain': { en: 'Try again', ko: '다시 시도' },
  'byok.research.noEngine': {
    en: 'To research posts, add an OpenAI, Anthropic, Gemini or OpenRouter key in Social Archiver settings.',
    ko: '글을 리서치하려면 Social Archiver 설정에서 OpenAI, Anthropic, Gemini 또는 OpenRouter 키를 추가하세요.',
  },
  'byok.research.noEngineDesktop': {
    en: 'To research posts, add an AI API key in Social Archiver settings, or install Claude Code, Gemini CLI or Codex.',
    ko: '글을 리서치하려면 Social Archiver 설정에서 AI API 키를 추가하거나 Claude Code, Gemini CLI, Codex를 설치하세요.',
  },
  'byok.research.noText': { en: 'This post has no text to research.', ko: '이 글에는 리서치할 텍스트가 없어요.' },
} satisfies Record<string, LocaleText>;
