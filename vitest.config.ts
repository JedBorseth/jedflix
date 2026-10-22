import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./apps/web/src", import.meta.url).pathname,
      "@convex": new URL("./convex", import.meta.url).pathname,
    },
  },
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "apps/web/tests/*.vitest.tsx"],
  },
});
