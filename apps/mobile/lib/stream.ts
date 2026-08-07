import { createStreamClient } from "@jedflix/stream-client";
import Constants from "expo-constants";

const apiBase =
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  process.env.EXPO_PUBLIC_STREAM_API_URL ??
  Constants.expoConfig?.extra?.backendUrl ??
  Constants.expoConfig?.extra?.streamApiUrl ??
  "/backend";

const apiKey =
  process.env.EXPO_PUBLIC_BACKEND_API_KEY ??
  process.env.EXPO_PUBLIC_STREAM_API_KEY ??
  Constants.expoConfig?.extra?.backendApiKey ??
  Constants.expoConfig?.extra?.streamApiKey;

export const streamClient = createStreamClient({ apiBase, apiKey });
