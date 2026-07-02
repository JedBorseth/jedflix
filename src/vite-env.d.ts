/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY: string;
  readonly VITE_STREAM_API_URL?: string;
  readonly VITE_STREAM_API_KEY?: string;
}

interface Document {
  startViewTransition?: (callback: () => void) => void;
}
