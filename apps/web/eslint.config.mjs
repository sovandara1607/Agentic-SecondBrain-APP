import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied by scripts/copy-tinymce.js (predev/prebuild), not our source.
    "public/tinymce/**",
    // Plain Node/CJS build scripts, not part of the Next.js app itself.
    "scripts/**",
  ]),
]);

export default eslintConfig;
