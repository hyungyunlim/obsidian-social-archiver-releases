/**
 * @social-archiver/byok-ai-core — AI with the user's own provider key, shared
 * by every engine. See ../README.md; edit here, then run
 * scripts/sync-byok-ai-core.sh. The barrel exports exactly the public API; the
 * names are chosen not to clash with cli-runtime's own exports, which
 * re-export this barrel.
 */
export {
  BYOK_EXECUTOR_COMMENT_TYPES,
  BYOK_PROVIDERS,
  BYOK_PROVIDER_IDS,
  BYOK_STORED_PROVIDER_IDS,
  byokAuthHeaders,
  byokCommentLabel,
  fromStoredProviderId,
  isByokProviderId,
  isByokStoredProviderId,
  keyFingerprint,
  listModelsRequest,
  parseListModels,
  toStoredProviderId,
  validateKeyRequest,
  type ByokModelInfo,
  type ByokProviderId,
  type ByokProviderSpec,
  type ByokStoredProviderId,
} from './providers';
// Request/response shapes: providers.ts builds ByokHttpRequest already, so they ship with M1.
export type { ByokHttpRequest, ByokHttpResponse, ByokTransport } from './transport';
export {
  BUNDLED_MODEL_CATALOG,
  MODEL_CATALOG_KV_KEY,
  MODEL_CATALOG_TTL_MS,
  MODEL_LIST_TTL_MS,
  capabilityModelOptions,
  matchesModelPattern,
  modelLifecycle,
  parseModelCatalog,
  resolveModel,
  type ByokModelCatalog,
  type ByokTask,
} from './models';
export {
  AI_COMMENTS_MAX_COUNT,
  AI_COMMENTS_MAX_TOTAL_BYTES,
  AI_COMMENT_DEFAULT_MAX_CHARS,
  AI_COMMENT_MAX_CHARS,
  AI_COMMENT_TRUNCATED_NOTE,
  aiCommentBudget,
  aiCommentMaxChars,
  aiCommentsTotalBytes,
  clipAICommentContent,
  fitTextToBudget,
  utf8ByteLength,
  type AICommentBudget,
} from './limits';
export { demoteHeadings, fitChatTranscript, formatChatTranscript, parseChatTranscript } from './transcript';
export { WEB_ACCESS_REQUEST, withSourceLinks, withWebAccessRequest } from './web';
export {
  AI_MENTIONS_PER_NOTE,
  AI_MENTION_HANDLES,
  aiMentionQueryAt,
  aiMentionSuggestions,
  findAIMentions,
  hasMentionQuestion,
  insertAIMention,
  isAnyNoteReply,
  isNoteReply,
  newAIMentions,
  noteQuestionText,
  noteReplyCommentId,
  noteReplySuffix,
  noteReplyTranscript,
  splitNoteReplies,
  type AIMention,
  type AIMentionHandle,
  type AIMentionTarget,
} from './mentions';
export {
  ARTICLE_CONTEXT_MAX_CHARS,
  COMMENTS_DIGEST_MAX_CHARS,
  buildArticleContext,
  buildCommentsDigest,
  excerptForBudget,
  type ByokArticleInput,
} from './context';
export {
  CHAT_HISTORY_BUDGET_CHARS,
  CHAT_HISTORY_MAX_INPUT_CHARS,
  CHAT_MAX_ANSWER_CHARS,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MAX_QUESTION_CHARS,
  CHAT_MAX_USER_TURNS,
  CHAT_SYSTEM_INSTRUCTIONS,
  buildChatMessages,
  parseChatAskInput,
  promptToMessages,
  promptToText,
  type ByokMessage,
  type ByokPrompt,
  type ChatInputError,
} from './chat';
export {
  RESEARCH_MAX_FOCUS_CHARS,
  RESEARCH_MAX_OUTPUT_TOKENS,
  RESEARCH_SYSTEM_INSTRUCTIONS,
  buildResearchPrompt,
  formatResearchReport,
  type ByokResearchDepth,
} from './research';
export { COMMENT_SYSTEM_INSTRUCTIONS, buildCommentPrompt } from './comment-prompts';

// M2 exports (core-B): errors.ts, client.ts, engine.ts go below this line.
export {
  ByokError,
  byokErrorToJobErrorCode,
  isModelGoneError,
  normalizeProviderError,
  redactSecrets,
  type ByokErrorCode,
} from './errors';
export {
  createByokClient,
  type ByokCitation,
  type ByokClient,
  type ByokDeepResearchHandle,
  type ByokDeepResearchRequest,
  type ByokDeepResearchState,
  type ByokGenerateHandlers,
  type ByokGenerateRequest,
  type ByokGenerateResult,
  type ByokRunStatus,
  type ByokValidateResult,
} from './client';
export {
  createByokEngine,
  type ByokEngine,
  type ByokEngineDeps,
  type ByokKeyValueStore,
  type ByokRunResult,
} from './engine';
