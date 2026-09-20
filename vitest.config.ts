import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Deterministic core: the whole suite must pass with no network and no API key.
    environment: "node",
  },
});
