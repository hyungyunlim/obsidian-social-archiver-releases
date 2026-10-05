import { BrunchLocalService } from '../../services/BrunchLocalService';
import { NaverBlogLocalService } from '../../services/NaverBlogLocalService';
import { NaverCafeLocalService } from '../../services/NaverCafeLocalService';
import { NaverWebtoonLocalService } from '../../services/NaverWebtoonLocalService';

/**
 * URLs `PendingJobOrchestrator` archives on this device instead of sending to
 * `/api/archive` — so anything only the server applies (collections) can't
 * reach them. Mirrors the orchestrator's branches; keep the two in step.
 */
export function isArchivedLocally(url: string, naverCookie: string | undefined): boolean {
  return (NaverCafeLocalService.isCafeUrl(url) && Boolean(naverCookie))
    || NaverBlogLocalService.isBlogUrl(url)
    || BrunchLocalService.isBrunchUrl(url)
    || NaverWebtoonLocalService.isWebtoonUrl(url);
}
