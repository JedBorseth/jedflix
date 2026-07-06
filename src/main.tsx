import { ConvexAuthProvider } from "@convex-dev/auth/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { ConvexReactClient } from "convex/react";
import { registerSW } from "virtual:pwa-register";
import { BasicAuthGate } from "@/components/auth/BasicAuthGate";
import { installAuthenticatedFetch } from "@/lib/authenticatedFetch";
import { installViewTransitionGuard } from "@/lib/viewTransitionGuard";
import App from "./App.tsx";
import "./index.css";

installAuthenticatedFetch();

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

registerSW({ immediate: true });
installViewTransitionGuard();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <ConvexAuthProvider client={convex}>
        <BasicAuthGate>
          <App />
        </BasicAuthGate>
      </ConvexAuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
