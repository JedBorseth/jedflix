/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY: string;
  readonly VITE_STREAM_API_URL?: string;
  readonly VITE_STREAM_API_KEY?: string;
}
