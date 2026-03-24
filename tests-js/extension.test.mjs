import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("manifest exposes store-ready icon metadata", () => {
  const manifestPath = path.join(root, "extension", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.equal(manifest.name, "ByeGPT");
  assert.equal(manifest.short_name, "ByeGPT");
  assert.ok(manifest.icons["16"]);
  assert.ok(manifest.icons["48"]);
  assert.ok(manifest.icons["128"]);
  assert.ok(manifest.action.default_icon["16"]);
});

test("publish docs exist", () => {
  assert.ok(fs.existsSync(path.join(root, "docs", "chrome-web-store.md")));
  assert.ok(fs.existsSync(path.join(root, "site", "privacy-policy.html")));
  assert.ok(fs.existsSync(path.join(root, "site", "index.html")));
});

test("asset generator outputs required store images", () => {
  assert.ok(
    fs.existsSync(path.join(root, "extension", "icons", "icon-128.png")),
  );
  assert.ok(
    fs.existsSync(path.join(root, "store-assets", "screenshot-01.png")),
  );
  assert.ok(
    fs.existsSync(path.join(root, "store-assets", "promo-small-440x280.png")),
  );
});
