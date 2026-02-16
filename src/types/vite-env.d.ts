/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ENDPOINT: string;
  readonly VITE_SHARE_WEB_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
