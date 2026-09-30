#!/usr/bin/env node
// Regenerate the vendored floating-ui UMD bundles from the npm packages.
// The UMD builds in node_modules/@floating-ui/*/dist are the exact files we
// ship in content/vendor/. Copying them keeps the vendor folder a reproducible,
// byte-for-byte artifact of the pinned npm versions (see package.json).
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "content", "vendor");
mkdirSync(dest, { recursive: true });

const files = [
  ["@floating-ui/core/dist/floating-ui.core.umd.min.js", "floating-ui.core.umd.min.js"],
  ["@floating-ui/dom/dist/floating-ui.dom.umd.min.js", "floating-ui.dom.umd.min.js"],
];

for (const [src, name] of files) {
  const from = join(root, "node_modules", ...src.split("/"));
  const to = join(dest, name);
  cpSync(from, to);
  console.log(`vendored ${name}  <-  node_modules/${src}`);
}
console.log("Vendor bundles up to date.");
