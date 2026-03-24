import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const distDir = path.resolve("dist");
const entries = await fs.readdir(distDir);
const zipName = entries.find((entry) =>
  /^byegpt-extension-v.+\.zip$/.test(entry),
);

if (!zipName) {
  throw new Error("No packaged extension ZIP found in dist/.");
}

const zipPath = path.join(distDir, zipName);
const zipBuffer = await fs.readFile(zipPath);
const digest = createHash("sha256").update(zipBuffer).digest("hex");
const digestPath = `${zipPath}.sha256`;

await fs.writeFile(digestPath, `${digest}  ${path.basename(zipPath)}\n`);

console.log(zipPath);
console.log(digestPath);
