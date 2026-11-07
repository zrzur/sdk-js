// The three entry points: @zrzur/sdk and @zrzur/sdk/bot never load SolidJS.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Every bare package a built module pulls in, following relative imports */
function packagesOf(entry) {
  const seen = new Set();
  const packages = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!spec) continue;
      if (spec.startsWith(".")) visit(resolve(dirname(file), spec));
      else packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
    }
  };
  visit(join(root, entry));
  return packages;
}

test("package exports the three entry points", () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), [".", "./bot", "./package.json", "./solid"]);
  assert.equal(pkg.description, "The official Zrzur library for apps and bots");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.dependencies["solid-js"], undefined, "SolidJS is a peer dependency only");
  assert.equal(pkg.peerDependenciesMeta["solid-js"].optional, true);
});

for (const [entry, file] of [
  ["@zrzur/sdk", "lib/index.js"],
  ["@zrzur/sdk/bot", "lib/bot/index.js"],
]) {
  test(`${entry} works without SolidJS`, async () => {
    const packages = [...packagesOf(file)];
    assert.deepEqual(
      packages.filter((name) => name.includes("solid")),
      [],
      `${entry} imports ${packages.join(", ")}`,
    );
    for (const name of packages) assert.ok(pkg.dependencies[name], `${name} is a dependency`);
    await import(join(root, file).replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));
  });
}

test("@zrzur/sdk/solid uses SolidJS", () => {
  assert.ok(packagesOf("lib/solid/index.js").has("solid-js"));
});
