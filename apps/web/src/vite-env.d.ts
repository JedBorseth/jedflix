/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_BACKEND_API_KEY?: string;
  /** @deprecated Use VITE_BACKEND_URL */
  readonly VITE_STREAM_API_URL?: string;
  /** @deprecated Use VITE_BACKEND_API_KEY */
  readonly VITE_STREAM_API_KEY?: string;
}
