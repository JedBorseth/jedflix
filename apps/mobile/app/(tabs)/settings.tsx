import { api } from "@jedflix/convex-api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { Authenticated, Unauthenticated } from "convex/react";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

const LOCAL_RD_KEY = "jedflix.mobile.realDebridApiKey";

export default function SettingsScreen() {
  const settings = useQuery(api.userSettings.getForUser);
  const upsertSettings = useMutation(api.userSettings.upsert);
  const { signOut } = useAuthActions();
  const [rdKey, setRdKey] = useState("");

  useEffect(() => {
    void SecureStore.getItemAsync(LOCAL_RD_KEY).then((value) => {
      if (value) setRdKey(value);
    });
  }, []);

  useEffect(() => {
    if (settings?.realDebridApiKey) setRdKey(settings.realDebridApiKey);
  }, [settings]);

  async function saveSettings() {
    await SecureStore.setItemAsync(LOCAL_RD_KEY, rdKey);
    await upsertSettings({ realDebridApiKey: rdKey || undefined, streamMode: "direct" });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Streaming</Text>
      <Text style={styles.label}>Real Debrid API key</Text>
      <TextInput
        value={rdKey}
        onChangeText={setRdKey}
        secureTextEntry
        placeholder="Paste API key"
        placeholderTextColor="#71717a"
        style={styles.input}
      />
      <Text style={styles.helper}>
        Mobile streams directly from Real Debrid using the native video player.
      </Text>
      <Pressable style={styles.button} onPress={() => void saveSettings()}>
        <Text style={styles.buttonText}>Save Settings</Text>
      </Pressable>

      <Text style={styles.sectionTitle}>Account</Text>
      <Unauthenticated>
        <Pressable style={styles.button} onPress={() => router.push("/sign-in")}>
          <Text style={styles.buttonText}>Sign In</Text>
        </Pressable>
      </Unauthenticated>
      <Authenticated>
        <Pressable
          style={[styles.button, styles.secondaryButton]}
          onPress={() => {
            void signOut().then(() => router.replace("/(tabs)"));
          }}>
          <Text style={styles.buttonText}>Sign Out</Text>
        </Pressable>
      </Authenticated>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#09090b", padding: 16, gap: 12 },
  sectionTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginTop: 8 },
  label: { color: "#d4d4d8", fontSize: 14 },
  input: {
    backgroundColor: "#18181b",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  helper: { color: "#71717a", fontSize: 13, lineHeight: 18 },
  button: { backgroundColor: "#e50914", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  secondaryButton: { backgroundColor: "#3f3f46" },
  buttonText: { color: "#fff", fontWeight: "600" },
});
