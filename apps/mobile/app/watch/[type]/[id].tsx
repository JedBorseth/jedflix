import { api } from "@jedflix/convex-api";
import { useMutation, useQuery, useConvexAuth } from "convex/react";
import { router, useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MediaType } from "@jedflix/shared";
import { NativeStreamPlayer } from "@/components/NativeStreamPlayer";
import {
  checkInstantAvailability,
  formatRealDebridError,
  isRecoverableStreamError,
  resolveRealDebridStream,
} from "@/lib/realDebrid";
import { IOS_PLAYBACK_HINT, isIosDevice, sortSourcesForMobilePlayback } from "@/lib/iosPlayback";
import { fetchTorrentioSources, type MobileStreamSource } from "@/lib/torrentio";
import { tmdb } from "@/lib/tmdb";

const LOCAL_RD_KEY = "jedflix.mobile.realDebridApiKey";

type PlaybackState = {
  url: string;
  title: string;
  sourceIndex: number;
};

export default function WatchScreen() {
  const params = useLocalSearchParams<{ type: string; id: string }>();
  const mediaType = params.type as MediaType;
  const mediaId = Number(params.id);
  const settings = useQuery(api.userSettings.getForUser);
  const { isAuthenticated } = useConvexAuth();
  const upsertProgress = useMutation(api.watchHistory.upsertProgress);
  const lastSavedProgress = useMemo(() => ({ current: 0 }), []);

  const saveProgress = useCallback(
    (seconds: number) => {
      if (!isAuthenticated || seconds <= 0 || seconds - lastSavedProgress.current < 15) return;
      lastSavedProgress.current = seconds;
      void upsertProgress({
        mediaType,
        movieId: mediaId,
        progressSeconds: seconds,
      }).catch(() => {
        // Ignore progress save failures (e.g. auth race).
      });
    },
    [isAuthenticated, lastSavedProgress, mediaId, mediaType, upsertProgress],
  );

  const [imdbId, setImdbId] = useState<string | null>(null);
  const [sources, setSources] = useState<MobileStreamSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolveProgress, setResolveProgress] = useState<string | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rdToken, setRdToken] = useState<string | undefined>();

  useEffect(() => {
    void SecureStore.getItemAsync(LOCAL_RD_KEY).then((value) => {
      setRdToken(value ?? settings?.realDebridApiKey ?? undefined);
    });
  }, [settings?.realDebridApiKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadSources() {
      setLoadingSources(true);
      setError(null);
      setImdbId(null);

      if (mediaType === "tv") {
        setError("TV playback requires season and episode selection (coming soon).");
        setLoadingSources(false);
        return;
      }

      if (!rdToken?.trim()) {
        setError("Add your Real Debrid API key in Settings to stream.");
        setLoadingSources(false);
        return;
      }

      try {
        const [media, externalIds] = await Promise.all([
          tmdb.getMediaDetails(mediaType, mediaId),
          tmdb.getExternalIds(mediaType, mediaId),
        ]);
        if (!media) throw new Error("Title not found");
        if (!externalIds.imdbId) {
          throw new Error("This title does not have an IMDb ID required for streaming.");
        }
        if (cancelled) return;

        setImdbId(externalIds.imdbId);
        const found = await fetchTorrentioSources({
          type: mediaType,
          imdbId: externalIds.imdbId,
        });
        if (cancelled) return;

        const hashes = found.map((source) => source.infoHash).filter((hash): hash is string => !!hash);
        const cached = await checkInstantAvailability(rdToken, hashes);
        const withCache = found.map((source) => ({
          ...source,
          cached: source.infoHash ? !!cached[source.infoHash.toLowerCase()] : false,
        }));

        setSources(sortSourcesForMobilePlayback(withCache) as MobileStreamSource[]);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load sources");
        }
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    }

    void loadSources();
    return () => {
      cancelled = true;
    };
  }, [mediaType, mediaId, rdToken]);

  const resolveAndPlay = useCallback(
    async (startIndex: number) => {
      if (!imdbId) return;
      if (!rdToken?.trim()) {
        setError("Add your Real Debrid API key in Settings to stream.");
        return;
      }

      setResolving(true);
      setResolveProgress("Starting resolve");
      setError(null);
      setPlayback(null);

      const candidates = sources.slice(startIndex);
      let lastError: unknown = null;

      for (let attempt = 0; attempt < candidates.length; attempt++) {
        const candidate = candidates[attempt];
        if (!candidate) continue;
        const sourceIndex = startIndex + attempt;

        if (attempt > 0) {
          setResolveProgress(`Trying stream ${sourceIndex + 1} of ${sources.length}`);
        }

        try {
          const stream = await resolveRealDebridStream(
            candidate,
            { type: mediaType, imdbId, mode: "direct", realDebridToken: rdToken },
            rdToken,
            {
              fileIdx: candidate.fileIdx,
              onProgress: (progress) => setResolveProgress(progress),
            },
          );
          setPlayback({
            url: stream.directUrl ?? stream.url,
            title: stream.filename ?? candidate.title,
            sourceIndex,
          });
          setResolving(false);
          setResolveProgress(null);
          return;
        } catch (playError) {
          lastError = playError;
          if (!isRecoverableStreamError(playError) || attempt === candidates.length - 1) {
            break;
          }
        }
      }

      setError(formatRealDebridError(lastError));
      setResolving(false);
      setResolveProgress(null);
    },
    [imdbId, mediaType, rdToken, sources],
  );

  const handlePlaybackError = useCallback(
    (message: string) => {
      if (!playback) return;
      const nextIndex = playback.sourceIndex + 1;
      if (nextIndex >= sources.length) {
        setPlayback(null);
        setError(
          isIosDevice()
            ? `${IOS_PLAYBACK_HINT} (${message})`
            : `Playback failed: ${message}`,
        );
        return;
      }

      setError("This stream could not play. Trying another...");
      void resolveAndPlay(nextIndex);
    },
    [playback, resolveAndPlay, sources.length],
  );

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Choose a stream</Text>
        <Text style={styles.headerMeta}>Direct Real Debrid · Native player</Text>
        {isIosDevice() ? <Text style={styles.hint}>{IOS_PLAYBACK_HINT}</Text> : null}
        {loadingSources ? <ActivityIndicator color="#e50914" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {resolving ? (
          <Text style={styles.resolving}>{resolveProgress ?? "Resolving stream..."}</Text>
        ) : null}
      </View>
    ),
    [loadingSources, error, resolving, resolveProgress],
  );

  if (playback) {
    return (
      <NativeStreamPlayer
        key={playback.url}
        url={playback.url}
        title={playback.title}
        onPlaybackError={handlePlaybackError}
        onBack={() => setPlayback(null)}
        onProgress={isAuthenticated ? saveProgress : undefined}
      />
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={sources}
      keyExtractor={(item, index) => item.id || `source-${index}`}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      renderItem={({ item, index }) => (
        <Pressable
          style={styles.sourceRow}
          disabled={resolving}
          onPress={() => void resolveAndPlay(index)}>
          <Text style={styles.sourceTitle}>{item.title}</Text>
          <Text style={styles.sourceMeta}>
            {[
              item.cached ? "Cached" : null,
              item.sizeGb ? `${item.sizeGb.toFixed(1)} GB` : null,
              item.seeders ? `${item.seeders} seeders` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  list: { padding: 16, gap: 12 },
  header: { gap: 8, marginBottom: 12 },
  backButton: { alignSelf: "flex-start", paddingVertical: 4 },
  backButtonText: { color: "#e50914", fontSize: 16, fontWeight: "600" },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  headerMeta: { color: "#a1a1aa" },
  hint: { color: "#a1a1aa", fontSize: 12, lineHeight: 18 },
  error: { color: "#fca5a5" },
  resolving: { color: "#fde047" },
  sourceRow: {
    backgroundColor: "#18181b",
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  sourceTitle: { color: "#fff", fontSize: 14, marginBottom: 4 },
  sourceMeta: { color: "#a1a1aa", fontSize: 12 },
});
