/** Resolve Go backend base URL (public reverse-proxy path). */
export function getBackendApiBase(): string {
  return (
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_STREAM_API_URL ||
    "/backend"
  );
}
