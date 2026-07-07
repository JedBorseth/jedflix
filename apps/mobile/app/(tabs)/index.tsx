import { Link } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { MediaItem } from "@jedflix/shared";
import { getMobileMediaPath } from "@/lib/paths";
import { mediaRows, tmdb } from "@/lib/tmdb";

function PosterCard({ item }: { item: MediaItem }) {
  return (
    <Link href={getMobileMediaPath(item)} asChild>
      <Pressable style={styles.posterCard}>
        <Image source={{ uri: item.posterUrl }} style={styles.poster} />
        <Text numberOfLines={2} style={styles.posterTitle}>
          {item.title}
        </Text>
      </Pressable>
    </Link>
  );
}

function MediaRow({ title, items }: { title: string; items: MediaItem[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => `${item.mediaType}-${item.id}`}
        renderItem={({ item }) => <PosterCard item={item} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rowList}
      />
    </View>
  );
}

export default function BrowseScreen() {
  const [hero, setHero] = useState<MediaItem | null>(null);
  const [rows, setRows] = useState<Array<{ title: string; items: MediaItem[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const trending = await tmdb.getTrendingMedia();
        const movieRows = await Promise.all(
          mediaRows.movie.map(async (row) => ({
            title: row.title,
            items: await tmdb.discoverMedia("movie", { genreId: row.genreId }),
          })),
        );

        if (!cancelled) {
          setHero(trending[0] ?? null);
          setRows(movieRows);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load browse data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#e50914" size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.hintText}>Set EXPO_PUBLIC_TMDB_API_KEY in apps/mobile/.env</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {hero ? (
        <Link href={getMobileMediaPath(hero)} asChild>
          <Pressable style={styles.hero}>
            <Image source={{ uri: hero.backdropUrl }} style={styles.heroImage} />
            <View style={styles.heroOverlay}>
              <Text style={styles.heroTitle}>{hero.title}</Text>
              <Text numberOfLines={3} style={styles.heroDescription}>
                {hero.description}
              </Text>
            </View>
          </Pressable>
        </Link>
      ) : null}
      {rows.map((row) => (
        <MediaRow key={row.title} title={row.title} items={row.items.slice(0, 12)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b" },
  content: { paddingBottom: 32 },
  centered: { flex: 1, backgroundColor: "#09090b", alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: "#fca5a5", textAlign: "center", marginBottom: 8 },
  hintText: { color: "#a1a1aa", textAlign: "center" },
  hero: { height: 280, marginBottom: 16 },
  heroImage: { width: "100%", height: "100%" },
  heroOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: "700", marginBottom: 8 },
  heroDescription: { color: "#e4e4e7", fontSize: 14, lineHeight: 20 },
  row: { marginBottom: 20 },
  rowTitle: { color: "#fff", fontSize: 18, fontWeight: "600", marginHorizontal: 16, marginBottom: 8 },
  rowList: { paddingHorizontal: 12, gap: 12 },
  posterCard: { width: 120 },
  poster: { width: 120, height: 180, borderRadius: 8, backgroundColor: "#27272a" },
  posterTitle: { color: "#fafafa", fontSize: 12, marginTop: 6 },
});
