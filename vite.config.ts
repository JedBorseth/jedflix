import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { vttJsPlugin } from "./vite-plugin-vtt-js";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), vttJsPlugin()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      {
        find: /^vtt\.js$/,
        replacement: path.resolve(__dirname, "./src/lib/vtt-shim.cjs"),
      },
    ],
  },
  server: {
    proxy: {
      "/stream-api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/stream-api/, ""),
      },
    },
  },
});
