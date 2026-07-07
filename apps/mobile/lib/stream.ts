import { createStreamClient } from "@jedflix/stream-client";
import Constants from "expo-constants";

const apiBase =
  process.env.EXPO_PUBLIC_STREAM_API_URL ??
  Constants.expoConfig?.extra?.streamApiUrl ??
  "/stream-api";

const apiKey = process.env.EXPO_PUBLIC_STREAM_API_KEY ?? Constants.expoConfig?.extra?.streamApiKey;

export const streamClient = createStreamClient({ apiBase, apiKey });
