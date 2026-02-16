export interface ApiError {
  code: string;
  message: string;
  retryAfter?: number;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ArchiveRequest {
  url: string;
  options: {
    enableAI?: boolean;
    deepResearch?: boolean;
    downloadMedia?: boolean;
    includeComments?: boolean; // Include platform comments in response (default: true)
    pinterestBoard?: boolean;
  };
  licenseKey?: string;
  naverCookie?: string; // Naver: cookie for private cafe access
  sourceClientId?: string; // Sync client that initiated the archive (for dedup)
}

export interface ArchiveResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'series_selection_required';
  result?: {
    postData: unknown;
    creditsUsed: number;
  };
  error?: ApiError;
  // Naver Webtoon series selection response fields
  type?: 'series_selection_required';
  series?: {
    titleId: string;
    titleName: string;
    thumbnailUrl: string;
    author: string;
    synopsis: string;
    publishDay: string;
    finished: boolean;
    favoriteCount: number;
    age: number;
  };
  episodes?: Array<{
    no: number;
    subtitle: string;
    thumbnailUrl: string;
    starScore: number;
    serviceDateDescription: string;
    charge: boolean;
  }>;
  totalFreeEpisodes?: number;
}

export interface JobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: unknown;
  error?: ApiError;
}

export interface LicenseValidationRequest {
  licenseKey: string;
}

export interface LicenseValidationResponse {
  valid: boolean;
  plan: 'free' | 'pro';
  creditsRemaining: number;
  resetDate: string;
  features: string[];
}

// Batch Archive types (Google Maps batch)
export interface BatchArchiveTriggerRequest {
  urls: string[];
  platform: 'googlemaps';
  options?: {
    enableAI?: boolean;
    deepResearch?: boolean;
    downloadMedia?: boolean;
  };
}

export interface BatchArchiveTriggerResponse {
  batchJobId: string;
  snapshotId: string;
  status: 'pending' | 'processing';
  urlCount: number;
  creditsRequired: number;
  estimatedTime: number;
}

export interface BatchArchiveResult {
  url: string;
  status: 'completed' | 'failed';
  postData?: unknown;
  error?: string;
}

export interface BatchArchiveJobStatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  batchMetadata?: {
    urlCount: number;
    urls: string[];
    completedCount: number;
    failedCount: number;
  };
  results?: BatchArchiveResult[];
  result?: {
    creditsUsed: number;
    processingTime: number;
    totalResults: number;
    completedCount: number;
    failedCount: number;
  };
}
