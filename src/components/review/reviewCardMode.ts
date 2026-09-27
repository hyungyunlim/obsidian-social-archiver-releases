/**
 * How a review card asks before it tells.
 *
 * - `question`: the takeaway's recall question; the answer waits for a tap.
 * - `image`: a post whose picture can cue the memory. The picture stays in
 *   view and becomes the question; the words wait for a tap.
 * - `highlight`: the line the user marked. Seeing it again is the review, so
 *   nothing is hidden.
 * - `open`: a text-only post without a question. Nothing to hide.
 */
import type { ReviewCardUnit } from '../../services/learning/LearningReviewClient';
import type { PostData } from '../../types/post';

export type ReviewCardMode = 'question' | 'image' | 'highlight' | 'open';

export function reviewCardMode(
  unit: Pick<ReviewCardUnit, 'kind' | 'question'>,
  post: Pick<PostData, 'media'> | null,
): ReviewCardMode {
  if (unit.question) return 'question';
  if (unit.kind === 'highlight') return 'highlight';
  if (post?.media?.some((media) => media.type === 'image' || media.type === 'video')) return 'image';
  return 'open';
}

/** Modes whose answer is covered until the reader asks for it. */
export function coversAnswer(mode: ReviewCardMode): boolean {
  return mode === 'question' || mode === 'image';
}
