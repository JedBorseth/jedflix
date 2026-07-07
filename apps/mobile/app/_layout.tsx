import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useFonts } from "expo-font";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-reanimated";

import { convex } from "@/lib/convex";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

const jedflixTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#09090b",
    card: "#18181b",
    text: "#fafafa",
    border: "#27272a",
    primary: "#e50914",
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      void SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <ConvexAuthProvider client={convex}>
      <ThemeProvider value={jedflixTheme}>
        <Stack screenOptions={{ headerStyle: { backgroundColor: "#09090b" }, headerTintColor: "#fff" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ title: "Sign In", presentation: "modal" }} />
          <Stack.Screen name="media/[type]/[id]" options={{ title: "Details" }} />
          <Stack.Screen name="watch/[type]/[id]" options={{ title: "Watch", headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </ConvexAuthProvider>
  );
}
