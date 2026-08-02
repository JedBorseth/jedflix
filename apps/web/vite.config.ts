import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  // Load VITE_* vars from repo root .env.local (same file Docker/production uses).
  envDir: path.resolve(__dirname, "../.."),
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["convex.svg", "pwa-192x192.png", "pwa-512x512.png"],
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      manifest: {
        name: "JedFlix",
        short_name: "JedFlix",
        description: "Personal Netflix-style movie browser",
        theme_color: "#000000",
        background_color: "#000000",
        display: "fullscreen",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "@convex", replacement: path.resolve(__dirname, "../../convex") },
    ],
  },
  server: {
    proxy: {
      "/stream-api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        timeout: 15 * 60 * 1000,
        rewrite: (requestPath) => requestPath.replace(/^\/stream-api/, ""),
      },
    },
  },
});