/**
 * YouTube caption languages — wire contract (architecture plan §2, C0–C5).
 * Copied verbatim from the frozen contract; `normalizeTranscriptLanguage`
 * lives in `constants/languages.ts`.
 */

export type TranscriptKind = 'manual' | 'asr';

/** Server label for a primary whose language cannot be resolved (L6). Never a track language. */
export const TRANSCRIPT_UNKNOWN_LANGUAGE = 'und';

/** C2: entry[0] is the primary; the rest are added variants. */
export interface TranscriptLanguageSummary {
  language: string;
  kind: TranscriptKind | null;
  primary?: true;
}

/** C1 caption body JSON. */
export interface TranscriptSegmentJson {
  start_time: number;
  end_time?: number;
  duration?: number;
  text: string;
}

export interface ArchiveTranscriptJson {
  raw?: string;
  formatted?: TranscriptSegmentJson[];
  language?: string;
  kind?: TranscriptKind;
}

export type TranscriptTrackState = 'primary' | 'added' | 'available';

export interface AvailableTranscriptTrack {
  language: string;
  kind: TranscriptKind;
  name: string | null;
  state: TranscriptTrackState;
}

export interface AvailableTranscriptTracksResponse {
  primary: { language: string; kind: TranscriptKind | null } | null;
  tracks: AvailableTranscriptTrack[];
}

export interface ArchiveTranscriptBodyResponse {
  language: string;
  kind: TranscriptKind | null;
  role: 'primary' | 'variant';
  trackName: string | null;
  transcript: ArchiveTranscriptJson & { language: string };
}

export interface AddArchiveTranscriptRequest {
  language: string;
  kind?: TranscriptKind;
}

export interface AddArchiveTranscriptResponse extends ArchiveTranscriptBodyResponse {
  role: 'variant';
  action: 'added' | 'replaced';
  transcriptLanguages: TranscriptLanguageSummary[];
  updatedAt: string;
}

export interface DeleteArchiveTranscriptResponse {
  language: string;
  deletedAt: string;
  transcriptLanguages: TranscriptLanguageSummary[];
  updatedAt: string;
}

export interface SetPrimaryArchiveTranscriptResponse {
  primary: { language: string; kind: TranscriptKind | null; segmentCount: number } | null;
  variants: Array<{
    language: string;
    kind: TranscriptKind;
    trackName: string | null;
    segmentCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  transcriptLanguages: TranscriptLanguageSummary[] | null;
  changed: boolean;
  updatedAt: string;
}

/** C5 `transcript_variants_updated` WS payload. */
export interface TranscriptVariantsUpdatedEventData {
  archiveId: string;
  action: 'added' | 'removed' | 'primary_changed';
  language: string;
  languages: TranscriptLanguageSummary[];
  updatedAt: string;
  sourceClientId?: string;
}
