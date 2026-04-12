import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
      "@poly/trader-core": path.resolve(rootDir, "../../packages/trader-core/src"),
    },
  },
  test: {
    environment: "node",
  },
});
