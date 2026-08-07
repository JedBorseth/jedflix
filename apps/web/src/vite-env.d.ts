/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  /** @deprecated Use VITE_BACKEND_URL */
  readonly VITE_STREAM_API_URL?: string;
}
