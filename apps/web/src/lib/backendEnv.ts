/** Resolve Go backend base URL (public reverse-proxy path). */
export function getBackendApiBase(): string {
  return (
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_STREAM_API_URL ||
    "/backend"
  );
}

/** Shared API key shipped to the SPA (scraper deterrent only — not a user secret). */
export function getBackendApiKey(): string | undefined {
  return (
    import.meta.env.VITE_BACKEND_API_KEY ||
    import.meta.env.VITE_STREAM_API_KEY ||
    undefined
  );
}
