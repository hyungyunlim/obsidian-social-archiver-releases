import obsidianmd from 'eslint-plugin-obsidianmd';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-plugin/**',
      'build/**',
      'main.js',
      '**/*.config.js',
      '**/*.config.ts',
      'version-bump.mjs',
      'mobile-app/**',
      'mobile-app-svelte-backup/**',
      'workers/**',
      'share-web/**',
      'admin-dashboard/**',
      'scripts/**',
      'reference/**',
      'docs/**',
    ],
  },

  // obsidianmd recommended — includes:
  //   eslint:recommended, typescript-eslint recommendedTypeChecked,
  //   @microsoft/eslint-plugin-sdl, eslint-plugin-import, eslint-plugin-depend,
  //   and all obsidianmd rules
  ...obsidianmd.configs.recommended,

  // Enable type-aware linting for TS files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Custom sentence-case brand configuration for social platform names
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.svelte'],
    plugins: { obsidianmd },
    rules: {
      'obsidianmd/ui/sentence-case': ['error', {
        brands: [
          // Default brands (preserved from eslint-plugin-obsidianmd defaults)
          'iOS', 'iPadOS', 'macOS', 'Windows', 'Android', 'Linux',
          'Obsidian', 'Obsidian Sync', 'Obsidian Publish',
          'Google Drive', 'Dropbox', 'OneDrive', 'iCloud Drive',
          'YouTube', 'Slack', 'Discord', 'Telegram', 'WhatsApp', 'Twitter', 'X',
          'Readwise', 'Zotero', 'Excalidraw', 'Mermaid',
          'Markdown', 'LaTeX', 'JavaScript', 'TypeScript', 'Node.js',
          'npm', 'pnpm', 'Yarn', 'Git', 'GitHub', 'GitLab',
          'Notion', 'Evernote', 'Roam Research', 'Logseq', 'Anki', 'Reddit',
          'VS Code', 'Visual Studio Code', 'IntelliJ IDEA', 'WebStorm', 'PyCharm',
          // Social platforms not in the default list
          'Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'Pinterest',
          'Bluesky', 'Mastodon', 'Threads', 'Naver', 'Brunch', 'Webtoon',
          'Velog', 'Medium', 'RSS', 'Tumblr', 'Substack', 'Podcast',
          // Languages/locales
          'Korean', 'Japanese', 'Chinese', 'English', 'Spanish', 'French',
          // Tools/services
          'Whisper', 'Gumroad', 'Cloudflare', 'BrightData', 'Perplexity',
          'ffmpeg', 'faster-whisper', 'openai-whisper', 'whisper.cpp',
          // Map services
          'Google Maps',
          // Social Archiver product name
          'Social Archiver',
          // Acronyms with specific casing
          'OAuth', 'VRAM', 'CORS', 'ARM64',
          // Memory size units (preserve combined digit+unit tokens)
          '1GB', '2GB', '4GB', '5GB', '8GB', '10GB', '16GB', '32GB',
          // Technical identifiers (preserve casing)
          'NID_AUT', 'NID_SES',
        ],
      }],
    },
  },

  // Custom TS rule overrides on top of obsidianmd defaults
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // no-undef is redundant with TypeScript — TS provides better checking
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Svelte support
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        $state: 'readonly',
        $derived: 'readonly',
        $effect: 'readonly',
        $props: 'readonly',
        $bindable: 'readonly',
        $inspect: 'readonly',
        $host: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'svelte/no-at-html-tags': 'off',
      'svelte/a11y-click-events-have-key-events': 'off',
      'svelte/a11y-no-static-element-interactions': 'off',
      'svelte/a11y-no-interactive-element-to-noninteractive-role': 'off',
      'svelte/a11y-media-has-caption': 'off',
      'svelte/a11y-interactive-supports-focus': 'off',
    },
  },

  // Test files — use tsconfig.test.json and relax type-checking rules
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        // Vitest globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        test: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      'no-restricted-globals': 'off',
      'no-constant-binary-expression': 'off',
      'no-console': 'off',
      'obsidianmd/no-tfile-tfolder-cast': 'off',
      'prefer-const': 'off',
    },
  },

  // Global environment
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
);
