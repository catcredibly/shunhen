import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // Avoid a cold-start dependency scan blocking all four development WebViews.
  // Include browser dependencies explicitly, including lazily loaded chart modules.
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "i18next",
      "react-i18next",
      "lucide-react",
      "recharts",
      "@tauri-apps/api/app",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-autostart",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-fs",
      "@tauri-apps/plugin-notification",
      "@tauri-apps/plugin-process",
      "@tauri-apps/plugin-updater",
    ],
  },
  server: {
    strictPort: true,
    port: 1420,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
});
