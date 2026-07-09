import { useAuthActions } from "@convex-dev/auth/react";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

WebBrowser.maybeCompleteAuthSession();

type SocialProvider = "github" | "google";

export default function SignInScreen() {
  const { signIn } = useAuthActions();
  const [loading, setLoading] = useState<SocialProvider | null>(null);

  async function handleSignIn(provider: SocialProvider) {
    setLoading(provider);
    try {
      await signIn(provider);
      router.back();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(null);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in to JedFlix</Text>
      <Text style={styles.subtitle}>Sync My List, watch history, and settings across devices.</Text>
      <Pressable style={styles.button} disabled={loading !== null} onPress={() => void handleSignIn("github")}>
        <Text style={styles.buttonText}>{loading === "github" ? "Opening..." : "Continue with GitHub"}</Text>
      </Pressable>
      <Pressable style={styles.button} disabled={loading !== null} onPress={() => void handleSignIn("google")}>
        <Text style={styles.buttonText}>{loading === "google" ? "Opening..." : "Continue with Google"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b", padding: 24, gap: 16, justifyContent: "center" },
  title: { color: "#fff", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#a1a1aa", lineHeight: 22 },
  button: { backgroundColor: "#27272a", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
});
