import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import netlify from "@netlify/vite-plugin";

export default defineConfig({
  plugins: [react(), netlify()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // recharts (+ its d3 deps) is the heaviest dependency and is only
          // used by the analytics page — keep it out of the shared vendor chunk.
          if (
            id.includes("recharts") ||
            id.includes("d3-") ||
            id.includes("victory-vendor")
          ) {
            return "charts";
          }
          if (
            id.includes("react-router") ||
            id.includes("react-dom") ||
            id.includes("node_modules/react/") ||
            id.includes("scheduler")
          ) {
            return "react-vendor";
          }
          return "vendor";
        },
      },
    },
  },
});
