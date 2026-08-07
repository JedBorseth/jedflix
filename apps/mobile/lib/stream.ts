import { createStreamClient } from "@jedflix/stream-client";
import Constants from "expo-constants";

const apiBase =
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  process.env.EXPO_PUBLIC_STREAM_API_URL ??
  Constants.expoConfig?.extra?.backendUrl ??
  Constants.expoConfig?.extra?.streamApiUrl ??
  "/backend";

export const streamClient = createStreamClient({ apiBase });
