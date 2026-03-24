import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";

const manifest = JSON.parse(
  readFileSync(new URL("./extension/manifest.json", import.meta.url), "utf8"),
);
const distDir = path.resolve("dist");

export default defineConfig({
  root: "extension",
  plugins: [crx({ manifest })],
  build: {
    emptyOutDir: true,
    outDir: path.join(distDir, "unpacked"),
  },
  server: {
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
});
