import { afterEach, expect } from "bun:test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

(import.meta.env as Record<string, string>).VITE_BACKEND_URL ??= "/backend";

afterEach(() => {
  cleanup();
});
