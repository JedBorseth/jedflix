import { api } from "@jedflix/convex-api";
import { useMutation } from "convex/react";
import { Authenticated, Unauthenticated } from "convex/react";
import { Link, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MediaItem, MediaType } from "@jedflix/shared";
import { tmdb } from "@/lib/tmdb";

export default function MediaDetailScreen() {
  const params = useLocalSearchParams<{ type: string; id: string }>();
  const mediaType = params.type as MediaType;
  const mediaId = Number(params.id);
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void tmdb.getMediaDetails(mediaType, mediaId).then((details) => {
      if (!cancelled) {
        setMedia(details);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mediaType, mediaId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#e50914" />
      </View>
    );
  }

  if (!media) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>Title not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Image source={{ uri: media.backdropUrl }} style={styles.backdrop} />
      <View style={styles.content}>
        <Text style={styles.title}>{media.title}</Text>
        <Text style={styles.meta}>{media.rating}</Text>
        <Text style={styles.description}>{media.description}</Text>
        <Link
          href={{
            pathname: "/watch/[type]/[id]",
            params: { type: mediaType, id: String(mediaId) },
          }}
          asChild>
          <Pressable style={styles.playButton}>
            <Text style={styles.playButtonText}>Choose Stream</Text>
          </Pressable>
        </Link>
        <Authenticated>
          <MyListToggle mediaType={mediaType} movieId={mediaId} />
        </Authenticated>
        <Unauthenticated>
          <Pressable style={styles.secondaryButton} onPress={() => router.push("/sign-in")}>
            <Text style={styles.secondaryButtonText}>Sign in to save to My List</Text>
          </Pressable>
        </Unauthenticated>
      </View>
    </ScrollView>
  );
}

function MyListToggle({ mediaType, movieId }: { mediaType: MediaType; movieId: number }) {
  const toggle = useMutation(api.myList.toggle);

  return (
    <Pressable style={styles.secondaryButton} onPress={() => void toggle({ mediaType, movieId })}>
      <Text style={styles.secondaryButtonText}>Toggle My List</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  centered: { flex: 1, backgroundColor: "#09090b", alignItems: "center", justifyContent: "center" },
  error: { color: "#fca5a5" },
  backdrop: { width: "100%", height: 220, backgroundColor: "#27272a" },
  content: { padding: 16, gap: 12 },
  title: { color: "#fff", fontSize: 28, fontWeight: "700" },
  meta: { color: "#a1a1aa" },
  description: { color: "#e4e4e7", lineHeight: 22 },
  playButton: { backgroundColor: "#e50914", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  playButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondaryButton: {
    backgroundColor: "#27272a",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#fff" },
});
