// Copies the self-hosted TinyMCE assets (skins, icons, themes, plugins)
// into public/ so the editor loads from this app's own server instead of
// Tiny Cloud - no API key, no external request. See
// components/rich-text-editor.tsx for the licenseKey: 'gpl' pairing this
// requires (self-hosting the open-source build is GPL-licensed).
//
// Runs via the predev/prebuild npm scripts (not postinstall - in the
// Docker build, npm ci runs before the rest of the source, including this
// script, is copied into the image, so postinstall would fail there).
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "node_modules", "tinymce");
const dest = path.join(__dirname, "..", "public", "tinymce");

if (!fs.existsSync(src)) {
  console.error("tinymce not found in node_modules - run npm install first");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Copied tinymce assets to public/tinymce");
