import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The web app's own path alias, so a test can import web code that uses it
  // (the real turn path in tests/product/live-path.test.ts).
  resolve: { alias: { "@": fileURLToPath(new URL("./web", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // Deterministic core: the whole suite must pass with no network and no API key.
    environment: "node",
  },
});
