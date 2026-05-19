import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@trader/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
    },
  },
});
