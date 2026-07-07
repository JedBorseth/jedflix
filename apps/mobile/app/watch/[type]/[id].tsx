import { api } from "@jedflix/convex-api";
import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MediaType, StreamMode } from "@jedflix/shared";
import type { StreamSource } from "@jedflix/stream-client";
import { streamClient } from "@/lib/stream";
import { tmdb } from "@/lib/tmdb";

const LOCAL_RD_KEY = "jedflix.mobile.realDebridApiKey";

export default function WatchScreen() {
  const params = useLocalSearchParams<{ type: string; id: string }>();
  const mediaType = params.type as MediaType;
  const mediaId = Number(params.id);
  const settings = useQuery(api.userSettings.getForUser);
  const upsertProgress = useMutation(api.watchHistory.upsertProgress);

  const [sources, setSources] = useState<StreamSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rdToken, setRdToken] = useState<string | undefined>();

  const streamMode: StreamMode = settings?.streamMode ?? "direct";

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
      try {
        const media = await tmdb.getMediaDetails(mediaType, mediaId);
        if (!media?.imdbId) throw new Error("Missing IMDb ID for this title");
        const found = await streamClient.fetchSources(
          { type: mediaType, imdbId: media.imdbId },
          rdToken,
        );
        if (!cancelled) setSources(found);
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

  async function playSource(source: StreamSource) {
    setResolving(true);
    setError(null);
    try {
      const media = await tmdb.getMediaDetails(mediaType, mediaId);
      if (!media?.imdbId) throw new Error("Missing IMDb ID");

      const job = await streamClient.startResolve(
        {
          type: mediaType,
          imdbId: media.imdbId,
          mode: streamMode,
          magnet: source.magnet,
          infoHash: source.infoHash,
          realDebridToken: rdToken,
        },
        rdToken,
      );

      let current = job;
      while (current.status === "searching" || current.status === "downloading") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        current = await streamClient.pollResolve(current.jobId);
      }

      if (current.status === "failed" || !current.stream) {
        throw new Error(current.error ?? "Stream resolution failed");
      }

      const url = streamClient.getPlaybackUrl(current.stream);
      setPlaybackUrl(url);
    } catch (playError) {
      setError(playError instanceof Error ? playError.message : "Playback failed");
    } finally {
      setResolving(false);
    }
  }

  const player = useVideoPlayer(playbackUrl, (instance) => {
    instance.loop = false;
    instance.play();
  });

  useEffect(() => {
    if (!playbackUrl) return;
    const interval = setInterval(() => {
      const currentTime = player.currentTime;
      if (currentTime > 0) {
        void upsertProgress({
          mediaType,
          movieId: mediaId,
          progressSeconds: Math.floor(currentTime),
        });
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [playbackUrl, player, upsertProgress, mediaType, mediaId]);

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Choose a stream</Text>
        <Text style={styles.headerMeta}>Mode: {streamMode}</Text>
        {loadingSources ? <ActivityIndicator color="#e50914" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {resolving ? <Text style={styles.resolving}>Resolving stream...</Text> : null}
      </View>
    ),
    [streamMode, loadingSources, error, resolving],
  );

  if (playbackUrl) {
    return (
      <View style={styles.playerContainer}>
        <VideoView style={styles.video} player={player} allowsFullscreen allowsPictureInPicture />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={sources}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable style={styles.sourceRow} disabled={resolving} onPress={() => void playSource(item)}>
          <Text style={styles.sourceTitle}>{item.title}</Text>
          <Text style={styles.sourceMeta}>
            {[item.cached ? "Cached" : null, item.seeders ? `${item.seeders} seeders` : null]
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
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  headerMeta: { color: "#a1a1aa" },
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
  playerContainer: { flex: 1, backgroundColor: "#000" },
  video: { flex: 1 },
});
