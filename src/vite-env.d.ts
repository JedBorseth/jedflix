/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TMDB_API_KEY: string;
}

interface Document {
  startViewTransition?: (callback: () => void) => void;
}
