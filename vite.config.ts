import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig(({ mode }) => ({
  define: {
    // Inject environment variables at build time
    'import.meta.env.VITE_API_ENDPOINT': JSON.stringify(
      mode === 'development'
        ? 'http://localhost:8787'
        : 'https://social-archiver-api.social-archive.org'
    ),
    'import.meta.env.VITE_SHARE_WEB_URL': JSON.stringify(
      mode === 'development'
        ? 'http://localhost:5173'
        : 'https://social-archive.org'
    ),
  },
  plugins: [
    svelte({
      compilerOptions: {
        // Enable Svelte 5 Runes API
        runes: true
      }
    })
  ],
  // PostCSS is automatically detected via postcss.config.js
  css: {
    postcss: './postcss.config.js'
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.js'
    },
    rollupOptions: {
      external: ['obsidian'],
      output: {
        dir: 'dist-plugin',
        entryFileNames: 'main.js',
        assetFileNames: 'styles.css',
        // Disable code splitting - bundle everything into main.js
        inlineDynamicImports: true,
        globals: {
          obsidian: 'obsidian'
        }
      }
    },
    minify: mode === 'source' ? false : 'terser',
    cssMinify: mode === 'source' ? false : 'esbuild',
    ...(mode !== 'source' && {
      terserOptions: {
        compress: {
          drop_console: false, // Keep console for debugging
          drop_debugger: true,
          // pure_funcs: ['console.log'] // DISABLED for debugging
        },
        mangle: {
          safari10: true
        }
      }
    }),
    sourcemap: false, // Disable inline sourcemap to reduce size
    emptyOutDir: false,
    outDir: 'dist-plugin',
    cssCodeSplit: false
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
      '@shared': path.resolve(__dirname, './src/shared')
    }
  },
  optimizeDeps: {
    exclude: ['obsidian']
  },
  server: {
    open: false,
    port: 5173,
    hmr: {
      protocol: 'ws',
      host: 'localhost'
    }
  }
}));
