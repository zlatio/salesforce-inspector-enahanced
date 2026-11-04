// Rasterises assets/icon.svg into the PNG sizes Chrome needs (manifest icons must be PNG).
// Run with `node scripts/icons.mjs` after changing the SVG; requires rsvg-convert.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "public/icons");
mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), resolve(root, "assets/icon.svg"), "-o", resolve(out, `icon${size}.png`)]);
}
console.log("icons written to", out);
