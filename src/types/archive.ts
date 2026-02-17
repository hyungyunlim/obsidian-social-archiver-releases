export interface ArchiveOptions {
  enableAI: boolean;
  downloadMedia: boolean;
  removeTracking: boolean;
  generateShareLink: boolean;
  deepResearch: boolean;
  includeComments?: boolean;             // Include platform comments in note (default: true)
  includeTranscript?: boolean;           // YouTube: include full transcript
  includeFormattedTranscript?: boolean;  // YouTube: include formatted transcript with timestamps
  comment?: string;                      // User's personal note/comment
  pinterestBoard?: boolean;              // Pinterest board URL handling
  naverCookie?: string;                  // Naver: cookie for private cafe access
}

export interface ArchiveResult {
  success: boolean;
  filePath?: string;
  shareUrl?: string;
  creditsUsed: number;
  error?: string;
}

export interface YamlFrontmatter {
  share: boolean;
  shareUrl?: string;
  sharePassword?: string;
  shareMode?: 'full' | 'preview'; // How to display shared post
  platform: string;
  // User-posted content fields (platform: 'post')
  postedAt?: string; // When the note was posted (YYYY-MM-DD HH:mm)
  originalPath?: string; // Original note path for duplicate detection
  author: string;
  authorUrl: string;
  originalUrl: string;
  published: string; // Original post date in YYYY-MM-DD HH:mm format
  archived: string; // Date when archived (YYYY-MM-DD format)
  lastModified: string; // YYYY-MM-DD format
  download_time?: number; // Time taken to archive in seconds
  archive?: boolean; // Whether the post is archived (hidden from timeline)
  comment?: string; // User's personal note/comment
  like?: boolean; // User's personal like (for sorting/filtering)
  hasTranscript?: boolean; // YouTube: has full transcript text
  hasFormattedTranscript?: boolean; // YouTube: has formatted transcript with timestamps
  videoId?: string; // YouTube video ID
  duration?: number; // YouTube video duration in seconds
  likes?: number; // Engagement metrics
  comments?: number;
  shares?: number;
  views?: number;
  tags: string[];
  ai_summary?: string;
  sentiment?: string;
  topics?: string[];
  subscribed?: boolean;       // true if post was auto-archived via subscription
  subscriptionId?: string;    // ID of the subscription that triggered this archive
  // Podcast-specific fields
  audioUrl?: string;          // Podcast episode audio URL
  audioSize?: number;         // Audio file size in bytes
  audioType?: string;         // Audio MIME type (e.g., audio/mpeg)
  episode?: number;           // Podcast episode number
  season?: number;            // Podcast season number
  subtitle?: string;          // Episode subtitle
  hosts?: string[];           // Podcast hosts
  guests?: string[];          // Podcast guests
  explicit?: boolean;         // Explicit content flag
  downloadedUrls?: string[];  // URLs that have been downloaded or declined (format: "downloaded:URL" or "declined:URL")
  // Brunch series/book fields (also used for episode in podcasts and webtoons)
  series?: string;            // Series/brunchbook/webtoon title
  seriesUrl?: string;         // Series/brunchbook/webtoon URL
  seriesId?: string;          // Series/brunchbook/webtoon ID
  totalEpisodes?: number;     // Total episodes in series
  // Note: episode field above is shared with podcasts
  // Webtoon-specific fields
  starScore?: number;         // Webtoon episode rating (0-10)
  genre?: string[];           // Webtoon genres (e.g., ["판타지", "액션"])
  ageRating?: string;         // Age rating (e.g., "15세 이용가")
  finished?: boolean;         // Is the series completed
  publishDay?: string;        // Publish day (e.g., "토요웹툰")
  commentCount?: number;      // Webtoon episode comment count
  // Whisper transcription fields
  transcribedUrls?: string[]; // Audio paths that have been transcribed or declined (format: "transcribed:path" or "declined:path")
  transcription?: {
    model: string;            // Whisper model used
    language: string;         // Detected/specified language
    duration: number;         // Audio duration in seconds
    transcribedAt: string;    // ISO timestamp of transcription
    processingTime: number;   // Processing time in ms
    hasWordTimestamps: boolean;
  };
  // Multi-language transcript fields
  transcriptionLanguage?: string;    // Original transcript language ISO code
  transcriptLanguages?: string[];    // All available transcript language ISO codes (e.g., ['en', 'ko', 'ja'])
  isArticle?: boolean;               // X article (long-form) post marker
  [key: string]: unknown; // Allow custom fields
}

export interface ArchiveProgress {
  stage: 'fetching' | 'processing' | 'downloading' | 'saving' | 'complete';
  progress: number; // 0-100
  message: string;
}

export interface CreditUsage {
  basic: 1;
  withAI: 3;
  deepResearch: 5;
}
