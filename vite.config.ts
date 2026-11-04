import { defineConfig } from "vite";
import { resolve } from "node:path";

const r = (p: string) => resolve(import.meta.dirname, p);

// Extension pages (popup + app) and the background service worker.
export default defineConfig({
  root: r("src"),
  publicDir: r("public"),
  base: "./",
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    outDir: r("dist"),
    emptyOutDir: true,
    target: "chrome114",
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        app: r("src/app.html"),
        popup: r("src/popup.html"),
        sidepanel: r("src/sidepanel.html"),
        background: r("src/background/index.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
