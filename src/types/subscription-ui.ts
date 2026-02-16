export type SubscriptionStatus = 'active' | 'paused' | 'error' | 'crawling';

export interface SubscriptionDisplay {
  id: string;
  name: string;
  platform: string;
  handle: string;
  profileUrl: string;
  avatar?: string;
  status: SubscriptionStatus;
  enabled: boolean;
  schedule: {
    cron: string;
    timezone: string;
    displayText: string;
  };
  stats: {
    totalArchived: number;
    lastRunAt: string | null;
    lastRunStatus?: 'success' | 'failed' | 'partial';
  };
  errorMessage?: string;
  errorCount?: number;
}
