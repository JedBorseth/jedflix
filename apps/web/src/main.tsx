import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ConvexReactClient } from "convex/react";
import { registerSW } from "virtual:pwa-register";
import { queryClient } from "@/lib/queryClient";
import { installViewTransitionGuard } from "@/lib/viewTransitionGuard";
import App from "./App.tsx";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

registerSW({ immediate: true });
installViewTransitionGuard();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ConvexAuthProvider client={convex}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ConvexAuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
