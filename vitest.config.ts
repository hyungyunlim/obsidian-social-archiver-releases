import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

// Plugin test files that are already failing on main and are therefore skipped
// by the CI gate (VITEST_GATE=1) so that *new* breakage blocks a merge. They
// still run in a plain local `npx vitest run`, so the debt stays visible.
// Baseline captured 2026-08-07: 52 files / 293 tests, mostly three shared
// causes — `window.moment is not a function` (obsidian mock gap), "Failed to
// get 2D context from canvas" (no `canvas` dependency under jsdom), and
// "<X> not initialized. Call initialize() first." singleton API drift.
// ponytail: quarantine list, not a permanent tier — delete entries as they go
// green; a file that no longer fails can simply be removed from this array.
const CI_QUARANTINE = [
  'src/__tests__/components/MarkdownEditor.test.ts',
  'src/__tests__/components/MediaGrid.test.ts',
  'src/__tests__/components/ShareOptions.test.ts',
  'src/__tests__/components/billing/BillingEventsSection.test.ts',
  'src/__tests__/components/timeline/controllers/PlaybackAdapter.test.ts',
  'src/__tests__/components/timeline/renderers/PostCardRenderer.archiveMediaNoteSuggestions.test.ts',
  'src/__tests__/integration/schema-platform-detector.test.ts',
  'src/__tests__/modals/PlaceCandidateModal.test.ts',
  'src/__tests__/plugin/cli/ArchiveCliService.test.ts',
  'src/__tests__/plugin/sync/RemoteArchiveIngestService.test.ts',
  'src/__tests__/schemas/tiktok.test.ts',
  'src/__tests__/services/ArchiveOrchestrator.test.ts',
  'src/__tests__/services/AuthorAvatarService.test.ts',
  'src/__tests__/services/AuthorCatalogController.test.ts',
  'src/__tests__/services/BrightDataHttpClient.test.ts',
  'src/__tests__/services/CacheManager.test.ts',
  'src/__tests__/services/CircuitBreaker.test.ts',
  'src/__tests__/services/ComposedPostSyncService.test.ts',
  'src/__tests__/services/CreditManager-CreditPack.test.ts',
  'src/__tests__/services/CreditResetScheduler.test.ts',
  'src/__tests__/services/DraftService.test.ts',
  'src/__tests__/services/ErrorHandler.test.ts',
  'src/__tests__/services/ErrorNotificationService.test.ts',
  'src/__tests__/services/ErrorTracker.test.ts',
  'src/__tests__/services/ExponentialBackoff.test.ts',
  'src/__tests__/services/GumroadClient.test.ts',
  'src/__tests__/services/ImageOptimizer.test.ts',
  'src/__tests__/services/LicenseExpirationNotifier.test.ts',
  'src/__tests__/services/LicenseStorage.test.ts',
  'src/__tests__/services/LinkPreviewExtractor.test.ts',
  'src/__tests__/services/Logger.test.ts',
  'src/__tests__/services/MediaHandler.test.ts',
  'src/__tests__/services/PlatformDetector.test.ts',
  'src/__tests__/services/PostCreationService.test.ts',
  'src/__tests__/services/PromoCodeValidator.test.ts',
  'src/__tests__/services/RequestQueueManager.test.ts',
  'src/__tests__/services/ResilientHttpClient.test.ts',
  'src/__tests__/services/RetryService.test.ts',
  'src/__tests__/services/RetryableHttpClient.test.ts',
  'src/__tests__/services/ShareManager.test.ts',
  'src/__tests__/services/URLExpander.test.ts',
  'src/__tests__/services/VaultManager.test.ts',
  'src/__tests__/services/VaultStorageService.test.ts',
  'src/__tests__/services/WorkersAPIClient.billingEvents.test.ts',
  'src/__tests__/services/base/ServiceContainer.test.ts',
  'src/__tests__/services/markdown/MediaFormatter.localpath-guard.test.ts',
  'src/__tests__/shared/platform-types.test.ts',
  'src/__tests__/types/ai-comment.test.ts',
  'src/__tests__/types/profile-crawl.test.ts',
  'src/__tests__/utils/encryption.test.ts',
  'src/__tests__/utils/urlAnalysis.test.ts',
  'src/plugin/sync/__tests__/localOnlySyncExclusion.test.ts'
];

export default defineConfig({
  plugins: [
    {
      ...svelte({
        hot: false,
        emitCss: false,
        compilerOptions: {
          runes: true
        }
      }),
      // Override configureServer to prevent the hot-update error
      configureServer: undefined
    }
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // Without an explicit include, vitest's default glob makes a bare root
    // `npx vitest run` collect ~2,400 files from every sub-project (workers,
    // mobile-app, desktop-app, chrome-extension, share-web, ...) under this
    // jsdom + obsidian-alias setup. Those all have their own configs and CI;
    // this config owns the Obsidian plugin only.
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'test/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'shared/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      // .ts only: scripts/sync-shared.test.mjs is a `node --test` file.
      'scripts/**/*.{test,spec}.ts'
    ],
    exclude: [
      '**/node_modules/**',
      '.claude/worktrees/**',
      ...(process.env.VITEST_GATE ? CI_QUARANTINE : [])
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'test',
        '*.config.ts',
        '*.config.js',
        'src/main.ts' // Exclude plugin entry point
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@types': path.resolve(__dirname, './src/types'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@shared': path.resolve(__dirname, './src/shared'),
      'obsidian': path.resolve(__dirname, './test/mocks/obsidian.ts')
    }
  }
});