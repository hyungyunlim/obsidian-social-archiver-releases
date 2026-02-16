import type { PostIndexEntry } from './PostIndexService';

/**
 * SearchIndexService — Inverted index for instant O(1) token lookup.
 *
 * Instead of O(n) linear scan across all posts' searchText,
 * this service pre-builds a token → Set<filePath> map so that
 * search queries can be answered by intersecting token sets.
 *
 * Supports:
 * - Multi-token AND queries (intersect sets)
 * - Prefix matching (partial typing)
 * - Incremental add/remove (no full rebuild on single post change)
 * - Korean text tokenization (가-힣 range)
 */
export class SearchIndexService {
  /** Token → Set of filePaths */
  private index: Map<string, Set<string>> = new Map();

  /** Track which tokens belong to each filePath (for efficient removal) */
  private reverseIndex: Map<string, Set<string>> = new Map();

  /**
   * Build the full index from a set of PostIndexEntries.
   * Clears any existing index.
   */
  buildIndex(entries: PostIndexEntry[]): void {
    this.index.clear();
    this.reverseIndex.clear();

    for (const entry of entries) {
      this.addEntryInternal(entry);
    }
  }

  /**
   * Search for posts matching all tokens in the query.
   * Returns a Set of filePaths that match.
   * Empty query returns empty set (caller should skip filtering).
   */
  search(query: string): Set<string> {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return new Set();

    let result: Set<string> | null = null;

    for (const token of queryTokens) {
      const matches = this.findMatchingFilePaths(token);
      if (result === null) {
        result = new Set(matches);
      } else {
        // Intersect: keep only entries present in both sets
        const intersection = new Set<string>();
        for (const id of result) {
          if (matches.has(id)) {
            intersection.add(id);
          }
        }
        result = intersection;
      }
      // Short-circuit: if no results, no need to check more tokens
      if (result.size === 0) return result;
    }

    return result || new Set();
  }

  /**
   * Add a single entry to the index (incremental).
   */
  addEntry(entry: PostIndexEntry): void {
    // Remove old tokens first (in case of update)
    this.removeEntry(entry.filePath);
    this.addEntryInternal(entry);
  }

  /**
   * Remove a single entry from the index.
   */
  removeEntry(filePath: string): void {
    const tokens = this.reverseIndex.get(filePath);
    if (!tokens) return;

    for (const token of tokens) {
      const set = this.index.get(token);
      if (set) {
        set.delete(filePath);
        if (set.size === 0) {
          this.index.delete(token);
        }
      }
    }
    this.reverseIndex.delete(filePath);
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.index.clear();
    this.reverseIndex.clear();
  }

  /** Number of unique tokens in the index. */
  get tokenCount(): number {
    return this.index.size;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private addEntryInternal(entry: PostIndexEntry): void {
    const tokens = this.tokenize(entry.searchText);
    const tokenSet = new Set(tokens);
    this.reverseIndex.set(entry.filePath, tokenSet);

    for (const token of tokenSet) {
      let set = this.index.get(token);
      if (!set) {
        set = new Set();
        this.index.set(token, set);
      }
      set.add(entry.filePath);
    }
  }

  /**
   * Tokenize text: lowercase, split on whitespace and punctuation.
   * Keeps Korean characters (가-힣) and Latin alphanumerics.
   * Filters tokens shorter than 2 characters.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  /**
   * Find all filePaths matching a token prefix.
   * Exact match is checked first (fast path),
   * then prefix scan for partial queries.
   */
  private findMatchingFilePaths(token: string): Set<string> {
    // Fast path: exact match
    const exact = this.index.get(token);
    if (exact && exact.size > 0) {
      // For short tokens (2-3 chars), also do prefix matching
      // as the user might still be typing
      if (token.length > 3) {
        return exact;
      }
    }

    // Prefix matching: scan all keys
    const result = new Set<string>();
    for (const [key, ids] of this.index) {
      if (key.startsWith(token)) {
        for (const id of ids) {
          result.add(id);
        }
      }
    }
    return result;
  }
}
