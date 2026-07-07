import { api } from "@jedflix/convex-api";
import { useQuery } from "convex/react";
import { Link, router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MediaItem } from "@jedflix/shared";
import { getMobileMediaPath } from "@/lib/paths";
import { tmdb } from "@/lib/tmdb";

export default function MyListScreen() {
  const saved = useQuery(api.myList.getForUser);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!saved || saved.length === 0) {
      setItems([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void tmdb
      .getMediaDetailsByIds(
        saved.map((entry) => ({ mediaType: entry.mediaType, movieId: entry.movieId })),
      )
      .then((media) => {
        if (!cancelled) setItems(media);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [saved]);

  if (saved === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#e50914" />
      </View>
    );
  }

  if (saved.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Your list is empty</Text>
        <Text style={styles.subtitle}>Sign in and add titles from a detail page.</Text>
        <Pressable style={styles.button} onPress={() => router.push("/sign-in")}>
          <Text style={styles.buttonText}>Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading ? <ActivityIndicator color="#e50914" style={{ margin: 16 }} /> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => `${item.mediaType}-${item.id}`}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Link href={getMobileMediaPath(item)} asChild>
            <Pressable style={styles.row}>
              <Image source={{ uri: item.posterUrl }} style={styles.poster} />
              <Text style={styles.itemTitle}>{item.title}</Text>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  centered: {
    flex: 1,
    backgroundColor: "#09090b",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "600" },
  subtitle: { color: "#a1a1aa", textAlign: "center" },
  button: { backgroundColor: "#e50914", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: "#fff", fontWeight: "600" },
  list: { padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  poster: { width: 64, height: 96, borderRadius: 6, backgroundColor: "#27272a" },
  itemTitle: { color: "#fff", fontSize: 16, flex: 1 },
});
