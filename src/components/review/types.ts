import type { ReviewArchiveLabel } from '../../services/learning/LearningReviewClient';
import type { PanelState, ReviewSession } from '../../services/learning/ReviewSession';

/** ReviewPanel.svelte's props — declared in TS so plain `tsc` can check callers. */
export interface ReviewPanelProps {
  session: ReviewSession;
  /** The day a link asked for; the device's today when absent. */
  initialDay?: string;
  hasNote: (archiveId: string) => boolean;
  openArchive: (archiveId: string, label: ReviewArchiveLabel | undefined) => void;
  openSettings: () => void;
  turnOn: () => Promise<void>;
  onchange?: (state: PanelState) => void;
}

/** What the view calls on the mounted panel. */
export interface ReviewPanelExports {
  reload: (day?: string) => Promise<void>;
}
