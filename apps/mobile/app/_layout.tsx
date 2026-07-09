import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useFonts } from "expo-font";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, type ReactNode } from "react";
import "react-native-reanimated";

import { tokenStorage } from "@/lib/authStorage";
import { convex } from "@/lib/convex";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

SplashScreen.preventAutoHideAsync();

function AuthRoot({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <ConvexAuthProvider
      client={convex}
      storage={tokenStorage}
      replaceURL={(relativeUrl) => {
        router.replace(relativeUrl as never);
      }}>
      {children}
    </ConvexAuthProvider>
  );
}

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
    <AuthRoot>
      <Stack screenOptions={{ headerStyle: { backgroundColor: "#09090b" }, headerTintColor: "#fff", contentStyle: { backgroundColor: "#09090b" } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ title: "Sign In", presentation: "modal" }} />
        <Stack.Screen name="media/[type]/[id]" options={{ title: "Details" }} />
        <Stack.Screen name="watch/[type]/[id]" options={{ title: "Watch", headerShown: false }} />
      </Stack>
    </AuthRoot>
  );
}
