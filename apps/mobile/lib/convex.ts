import Constants from "expo-constants";
import { ConvexReactClient } from "convex/react";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL ?? Constants.expoConfig?.extra?.convexUrl;

if (!convexUrl) {
  console.warn("Missing EXPO_PUBLIC_CONVEX_URL for the mobile app.");
}

export const convex = new ConvexReactClient(convexUrl ?? "https://placeholder.convex.cloud");
