import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Bound concurrent worker startup, especially for the jsdom test files.
      maxWorkers: 2,
    },
  }),
);

