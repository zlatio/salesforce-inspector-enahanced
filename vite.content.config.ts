import { defineConfig } from "vite";
import { resolve } from "node:path";

const r = (p: string) => resolve(import.meta.dirname, p);

// Content scripts cannot be ES modules, so the in-page launcher is built as a single IIFE.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: r("dist"),
    emptyOutDir: false,
    target: "chrome114",
    lib: { entry: r("src/content/index.ts"), formats: ["iife"], name: "SieLauncher", fileName: () => "content.js" },
  },
});
