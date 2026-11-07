// Fails when the backend source has a route the SDK's route table does not know.
//   node scripts/check-backend-routes.mjs <path to the backend repo>
// Reads every `#[openapi]` handler (`#[get("/<id>/x")]` …; `#[openapi(skip)]` is left out of the
// document on purpose) in crates/delta/src/routes
// and looks for it in src/api/routes.ts, with the mount prefix ignored and
// parameter names normalised (the match is on the path's tail and HTTP method).
// This catches a route added to the backend before `pnpm api:fetch` ran; the
// exact check against a running server is `pnpm api:check --against <url>`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = process.argv[2];
if (!backend) {
  console.error("usage: node scripts/check-backend-routes.mjs <backend repo>");
  process.exit(2);
}
const routesDir = join(backend, "crates/delta/src/routes");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith(".rs")) yield p;
  }
}

const norm = (p) =>
  p
    .replace(/\?.*$/, "")
    .replace(/[<{][^>}/]*(\.\.)?[>}]/g, "{}")
    .replace(/\/+$/, "");

// Routes deliberately outside the OpenAPI document (called through `raw()`).
const OUTSIDE_DOCUMENT = new Set(["POST /token"]); // oauth2 token endpoint

const known = [];
for (const m of readFileSync(join(root, "src/api/routes.ts"), "utf8").matchAll(
  /method: "(\w+)"; path: `[^`]*`; template: "([^"]*)"/g,
)) {
  known.push([m[1], norm(m[2])]);
}

const re =
  /#\[openapi(?!\(skip\))[^\]]*\]\s*(?:\/\/[^\n]*\n\s*|#\[[^\]]*\]\s*)*#\[(get|post|put|patch|delete)\(\s*"([^"]*)"/g;
const missing = [];
let seen = 0;
for (const file of walk(routesDir)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(re)) {
    seen++;
    const method = m[1];
    const tail = norm(m[2]) || "/";
    const ok =
      OUTSIDE_DOCUMENT.has(`${method.toUpperCase()} ${m[2]}`) ||
      known.some(
        ([km, kp]) =>
          km === method &&
          (tail === "/" ? true : kp === tail || kp.endsWith(tail)),
      );
    if (!ok)
      missing.push(
        `${method.toUpperCase()} ${m[2]}  (${file.slice(backend.length + 1)})`,
      );
  }
}
if (seen === 0) {
  console.error(`no #[openapi] handlers found under ${routesDir}`);
  process.exit(2);
}
if (missing.length) {
  console.error(
    `The backend has ${missing.length} route(s) the SDK does not know. Run pnpm api:fetch, then pnpm api:generate:`,
  );
  for (const line of missing) console.error("  " + line);
  process.exit(1);
}
console.log(`SDK knows all ${seen} backend routes.`);
