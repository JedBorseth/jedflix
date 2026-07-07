import { api } from "@jedflix/convex-api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { Authenticated, Unauthenticated } from "convex/react";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { StreamMode } from "@jedflix/shared";

const LOCAL_RD_KEY = "jedflix.mobile.realDebridApiKey";

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Unauthenticated>
        <Text style={styles.sectionTitle}>Account</Text>
        <Pressable style={styles.button} onPress={() => router.push("/sign-in")}>
          <Text style={styles.buttonText}>Sign In</Text>
        </Pressable>
      </Unauthenticated>
      <Authenticated>
        <SignedInSettings />
      </Authenticated>
    </View>
  );
}

function SignedInSettings() {
  const settings = useQuery(api.userSettings.getForUser);
  const upsertSettings = useMutation(api.userSettings.upsert);
  const { signOut } = useAuthActions();
  const [rdKey, setRdKey] = useState("");
  const [streamMode, setStreamMode] = useState<StreamMode>("direct");

  useEffect(() => {
    void SecureStore.getItemAsync(LOCAL_RD_KEY).then((value) => {
      if (value) setRdKey(value);
    });
  }, []);

  useEffect(() => {
    if (settings?.realDebridApiKey) setRdKey(settings.realDebridApiKey);
    if (settings?.streamMode) setStreamMode(settings.streamMode);
  }, [settings]);

  async function saveSettings() {
    await SecureStore.setItemAsync(LOCAL_RD_KEY, rdKey);
    await upsertSettings({ realDebridApiKey: rdKey || undefined, streamMode });
  }

  return (
    <>
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
      <Text style={styles.label}>Stream mode</Text>
      <View style={styles.modeRow}>
        {(["direct", "proxy"] as const).map((mode) => (
          <Pressable
            key={mode}
            style={[styles.modeButton, streamMode === mode && styles.modeButtonActive]}
            onPress={() => setStreamMode(mode)}>
            <Text style={styles.modeButtonText}>{mode}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.button} onPress={() => void saveSettings()}>
        <Text style={styles.buttonText}>Save Settings</Text>
      </Pressable>
      <Pressable
        style={[styles.button, styles.secondaryButton]}
        onPress={() => {
          void signOut().then(() => router.replace("/(tabs)"));
        }}>
        <Text style={styles.buttonText}>Sign Out</Text>
      </Pressable>
    </>
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
  modeRow: { flexDirection: "row", gap: 8 },
  modeButton: {
    flex: 1,
    backgroundColor: "#27272a",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  modeButtonActive: { backgroundColor: "#e50914" },
  modeButtonText: { color: "#fff", textTransform: "capitalize" },
  button: { backgroundColor: "#e50914", paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  secondaryButton: { backgroundColor: "#3f3f46" },
  buttonText: { color: "#fff", fontWeight: "600" },
});
