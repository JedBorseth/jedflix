import { Link } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { MediaItem } from "@jedflix/shared";
import { getMobileMediaPath } from "@/lib/paths";
import { tmdb } from "@/lib/tmdb";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const response = await tmdb.searchAll(trimmed);
      setResults(response.media);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search movies and shows"
          placeholderTextColor="#71717a"
          style={styles.input}
          returnKeyType="search"
          onSubmitEditing={() => void runSearch()}
        />
        <Pressable style={styles.button} onPress={() => void runSearch()}>
          <Text style={styles.buttonText}>Go</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color="#e50914" style={{ marginTop: 24 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={results}
        keyExtractor={(item) => `${item.mediaType}-${item.id}`}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Link href={getMobileMediaPath(item)} asChild>
            <Pressable style={styles.resultRow}>
              <Image source={{ uri: item.posterUrl }} style={styles.poster} />
              <View style={styles.resultText}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.meta}>{item.rating}</Text>
                <Text numberOfLines={2} style={styles.description}>
                  {item.description}
                </Text>
              </View>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b", padding: 16 },
  searchRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    backgroundColor: "#18181b",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: { backgroundColor: "#e50914", borderRadius: 8, paddingHorizontal: 16, justifyContent: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  error: { color: "#fca5a5", marginTop: 12 },
  list: { paddingTop: 16, gap: 12 },
  resultRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  poster: { width: 72, height: 108, borderRadius: 6, backgroundColor: "#27272a" },
  resultText: { flex: 1 },
  title: { color: "#fff", fontSize: 16, fontWeight: "600" },
  meta: { color: "#a1a1aa", marginTop: 4, marginBottom: 4 },
  description: { color: "#d4d4d8", fontSize: 13 },
});
