// Deliberately plain esbuild, no framework: three small entry points
// (background service worker, popup, options page) don't need React or
// a dev server, and Chrome loads the output directory directly via
// "Load unpacked" - no further packaging step for local development.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const OUT_DIR = "dist";

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: [
    "src/background.ts",
    "src/popup.ts",
    "src/options.ts",
  ],
  outdir: OUT_DIR,
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
});

cpSync("manifest.json", `${OUT_DIR}/manifest.json`);
cpSync("src/popup.html", `${OUT_DIR}/popup.html`);
cpSync("src/options.html", `${OUT_DIR}/options.html`);
cpSync("src/icons", `${OUT_DIR}/icons`, { recursive: true });

console.log(`Built to ${OUT_DIR}/ - load it unpacked via chrome://extensions`);
