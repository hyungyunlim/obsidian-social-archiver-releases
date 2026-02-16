import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Disable Runes for CJS compatibility
    runes: false,
    // CSS handling
    css: 'injected'
  }
};