import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const r = (p: string) => resolve(import.meta.dirname, p);

/**
 * Ships LICENSE and THIRD_PARTY_NOTICES.md in every build, and fails the build when it bundles a package
 * the notices don't credit (run `npm run notices` after changing dependencies).
 */
function licenseNotices(): Plugin {
  return {
    name: "license-notices",
    apply: "build",
    generateBundle() {
      const notices = readFileSync(r("THIRD_PARTY_NOTICES.md"), "utf8");
      const bundled = new Set<string>();
      for (const id of this.getModuleIds()) {
        const m = /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id.replace(/\\/g, "/"));
        if (m) bundled.add(m[1]);
      }
      const missing = [...bundled].filter((name) => !notices.includes("`" + name + "`"));
      if (missing.length) this.error(`THIRD_PARTY_NOTICES.md doesn't list ${missing.join(", ")}. Run \`npm run notices\`.`);
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.md", source: notices });
      this.emitFile({ type: "asset", fileName: "LICENSE", source: readFileSync(r("LICENSE"), "utf8") });
    },
  };
}

// Extension pages (popup + app) and the background service worker.
export default defineConfig({
  root: r("src"),
  publicDir: r("public"),
  base: "./",
  plugins: [licenseNotices()],
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
