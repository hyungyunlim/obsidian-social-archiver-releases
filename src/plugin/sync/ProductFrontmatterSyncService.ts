/**
 * Reconciles server-owned commerce data onto existing vault notes.
 *
 * Sibling of LocationFrontmatterSyncService, and deliberately a separate class:
 * the two reconcile disjoint field sets, and place confirms and price
 * enrichment are different features that fail independently.
 *
 * Why this exists at all: a note is written once, at archive time. Grade A
 * stores (Shopify, Cafe24) yield their whole snapshot from JSON-LD during the
 * fetch, so those notes are complete the moment they land. Grade B and C
 * (Coupang, Amazon, Naver) do not — the price arrives later, from a client that
 * could see the rendered page. Without this, that price never reaches the vault,
 * and neither does anything archived before commerce support shipped.
 *
 * Unrelated user fields — notes, comments, tags, body content — are never
 * touched.
 */

import type { App, TFile } from 'obsidian';
import type { LocalLockRegistry } from '../locks/LocalLockRegistry';
import { ProductBodyBlock } from '@/services/markdown/ProductBodyBlock';
import {
  isRenderableProductSnapshot,
  type ProductSnapshot,
} from '@/shared/platforms/products';

export interface RemoteArchiveProductSource {
  readonly id: string;
  readonly product?: unknown;
  readonly productSource?: string | null;
}

export interface DesiredProductFrontmatter {
  readonly productSource?: string;
}

export interface ProductReconcileResult {
  readonly failedArchiveIds: readonly string[];
}

export interface ProductFrontmatterSyncDeps {
  readonly app: App;
  readonly apiClient: () => {
    getUserArchive(archiveId: string): Promise<{ archive: RemoteArchiveProductSource }>;
  } | undefined;
  readonly findBySourceArchiveId: (archiveId: string) => TFile | null;
  readonly localLockRegistry?: LocalLockRegistry | undefined;
}

const LOG_PREFIX = '[Social Archiver] [ProductFrontmatterSync]';

/**
 * The only commerce field in frontmatter. The snapshot itself is an object, so
 * it lives in the `%% sa:product %%` body block — Obsidian's Properties editor
 * cannot render one. Kept as a list for symmetry with the location service, and
 * because `applyProductFrontmatter` deletes every managed key before writing,
 * which is what makes a server-side clear converge.
 */
const MANAGED_PRODUCT_FIELDS = ['productSource'] as const;

export const MAX_WS_RECONCILE_BATCH = 30;

/** Parse the server's `product` field. Unknown-typed because the API returns it untyped. */
export function readRemoteProductSnapshot(value: unknown): ProductSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as ProductSnapshot;
  return isRenderableProductSnapshot(candidate) ? candidate : null;
}

export function buildDesiredProductFrontmatter(
  archive: RemoteArchiveProductSource,
): DesiredProductFrontmatter {
  const productSource = typeof archive.productSource === 'string' && archive.productSource.trim()
    ? archive.productSource
    : null;
  return productSource ? { productSource } : {};
}

export function productFrontmatterNeedsWrite(
  frontmatter: Record<string, unknown> | undefined,
  desired: DesiredProductFrontmatter,
): boolean {
  const current = frontmatter ?? {};
  for (const key of MANAGED_PRODUCT_FIELDS) {
    if (current[key] !== desired[key]) return true;
  }
  return false;
}

export function applyProductFrontmatter(
  frontmatter: Record<string, unknown>,
  desired: DesiredProductFrontmatter,
): void {
  for (const key of MANAGED_PRODUCT_FIELDS) delete frontmatter[key];
  Object.assign(frontmatter, desired);
}

/** Key-order-independent equality, so a re-serialized snapshot is not false drift. */
export function sameProductSnapshot(
  a: ProductSnapshot | null,
  b: ProductSnapshot | null,
): boolean {
  if (a === null || b === null) return a === b;
  const canon = (snapshot: ProductSnapshot): string =>
    JSON.stringify(snapshot, Object.keys(snapshot).sort());
  return canon(a) === canon(b);
}

export class ProductFrontmatterSyncService {
  private disposed = false;

  constructor(private readonly deps: ProductFrontmatterSyncDeps) {}

  dispose(): void {
    this.disposed = true;
  }

  /**
   * Fetch each archive and reconcile it. Used by the WebSocket path, where only
   * archive ids arrive.
   */
  async reconcileArchiveIds(archiveIds: readonly string[]): Promise<ProductReconcileResult> {
    const uniqueIds = [...new Set(archiveIds)];
    const apiClient = this.deps.apiClient();
    if (!apiClient) return { failedArchiveIds: uniqueIds };
    if (this.disposed) return { failedArchiveIds: uniqueIds };
    const failedArchiveIds: string[] = [];

    for (let start = 0; start < uniqueIds.length; start += MAX_WS_RECONCILE_BATCH) {
      const chunk = uniqueIds.slice(start, start + MAX_WS_RECONCILE_BATCH);
      for (let offset = 0; offset < chunk.length; offset += 1) {
        const archiveId = chunk[offset];
        if (!archiveId) continue;
        const absoluteIndex = start + offset;
        if (this.disposed) {
          return { failedArchiveIds: [...failedArchiveIds, ...uniqueIds.slice(absoluteIndex)] };
        }
        const file = this.deps.findBySourceArchiveId(archiveId);
        if (!file) continue;
        try {
          const { archive } = await apiClient.getUserArchive(archiveId);
          if (this.disposed) {
            return { failedArchiveIds: [...failedArchiveIds, ...uniqueIds.slice(absoluteIndex)] };
          }
          await this.withWriteLocks(archiveId, () => this.reconcileFile(file, archive));
        } catch (error) {
          failedArchiveIds.push(archiveId);
          console.debug(LOG_PREFIX, 'Authoritative reconcile failed', {
            archiveId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return { failedArchiveIds };
  }

  /**
   * Offline catch-up during a library sweep. The archive is already fetched and
   * the caller already holds the write locks, so this costs no extra request —
   * which is what makes healing an entire back catalogue affordable.
   */
  async reconcileFromLibrarySync(
    file: TFile,
    archive: RemoteArchiveProductSource,
  ): Promise<void> {
    await this.reconcileFile(file, archive);
  }

  private async reconcileFile(
    file: TFile,
    archive: RemoteArchiveProductSource,
  ): Promise<void> {
    const cached = this.deps.app.metadataCache.getFileCache(file)?.frontmatter;
    const desired = buildDesiredProductFrontmatter(archive);
    const desiredProduct = readRemoteProductSnapshot(archive.product);

    const flatNeedsWrite = productFrontmatterNeedsWrite(cached, desired);

    // Read the note body only when this archive plausibly involves commerce.
    // A library sweep reconciles thousands of ordinary posts, and a per-file
    // read for each would be the expensive part of the whole pass.
    //
    // The frontmatter key is the cheap proxy: MarkdownConverter writes
    // `productSource` and the block together, so a note carrying a block
    // effectively always carries the key too. `flatNeedsWrite` covers the
    // remaining case — a server-side clear removes the key, which drags the
    // stale block out with it.
    const hasStoredProduct = cached?.['productSource'] !== undefined;
    let blockNeedsWrite = false;
    if (desiredProduct || hasStoredProduct || flatNeedsWrite) {
      const content = await this.deps.app.vault.cachedRead(file);
      const currentProduct = ProductBodyBlock.parse(content);
      blockNeedsWrite = !sameProductSnapshot(currentProduct, desiredProduct);
    }

    if (!flatNeedsWrite && !blockNeedsWrite) return;

    if (flatNeedsWrite) {
      await this.deps.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        applyProductFrontmatter(frontmatter, desired);
      });
    }

    if (blockNeedsWrite) {
      await this.deps.app.vault.process(file, (noteContent) =>
        ProductBodyBlock.upsert(noteContent, desiredProduct),
      );
    }
  }

  private async withWriteLocks<T>(archiveId: string, operation: () => Promise<T>): Promise<T> {
    const registry = this.deps.localLockRegistry;
    if (!registry) return operation();
    return registry.withLocks([
      { kind: 'archiveMaterialization', archiveId },
      { kind: 'markdownWrite', archiveId },
    ], operation);
  }
}
