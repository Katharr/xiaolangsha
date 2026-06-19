import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

import { aiProxyPlugin } from "./src/ai-proxy/vitePlugin";

export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
});
