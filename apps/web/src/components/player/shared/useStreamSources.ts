import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { fetchSources, type SourcesRequest, type StreamSource } from "@/lib/streamApi";

export function useStreamSources(
  request: SourcesRequest,
  token: string | undefined,
  resetPlayer: () => void,
) {
  const generation = useRef(0);
  const [sources, setSources] = useState<StreamSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    const id = ++generation.current;
    setSourcesLoading(true);
    setSourcesError(null);
    resetPlayer();
    try {
      const found = await fetchSources(request, token);
      if (id === generation.current) {
        setSources(found);
      }
    } catch (error) {
      if (id === generation.current) {
        setSources([]);
        setSourcesError(error instanceof Error ? error.message : "Failed to load streams");
      }
    } finally {
      if (id === generation.current) {
        setSourcesLoading(false);
      }
    }
  }, [request, resetPlayer, token]);

  useLayoutEffect(() => {
    void loadSources();
    return () => {
      generation.current += 1;
    };
  }, [loadSources]);

  return { sources, sourcesLoading, sourcesError, loadSources };
}
