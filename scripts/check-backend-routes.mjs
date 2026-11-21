// Fails when the backend source has a route the SDK's route table does not know.
//   node scripts/check-backend-routes.mjs <path to the backend repo>
//
// Reads the mount table of crates/delta/src/routes/mod.rs ("/servers" =>
// servers::routes(), ...), follows each group's `openapi_get_routes_spec![...]`
// list to its handlers, and builds each route's full path: mount prefix plus
// the handler's `#[get("/<id>/x")]`. Handlers marked `#[openapi(skip)]` are left
// out of the public document on purpose and are skipped here too. Every full
// path must be in src/api/routes.ts with the same method (parameter names
// do not matter).
//
// This catches a route added to the backend before `pnpm api:fetch` ran; the
// exact check against a running server is `pnpm api:check --against <url>`.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = process.argv[2];
if (!backend) {
  console.error("usage: node scripts/check-backend-routes.mjs <backend repo>");
  process.exit(2);
}
const routesDir = join(backend, "crates/delta/src/routes");

/** `/servers/<target>/members/<member..>?<q>` → `/servers/{}/members/{}` */
export const norm = (p) =>
  ("/" + p)
    .replace(/\?.*$/, "")
    .replace(/[<{][^>}/]*(\.\.)?[>}]/g, "{}")
    .replace(/\/+/g, "/")
    .replace(/(.)\/$/, "$1");

// Routes deliberately outside the OpenAPI document (called through `raw()`).
const OUTSIDE_DOCUMENT = new Set(["POST /oauth2/token"]);

/** The .rs file of a module path such as ["servers", "server_create"] */
function moduleFile(parts) {
  const base = join(routesDir, ...parts);
  for (const candidate of [base + ".rs", join(base, "mod.rs")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Text of the body of `fn name` in a file, braces balanced */
function functionBody(src, name) {
  const start = src.search(new RegExp(`\\bfn ${name}\\s*\\(`));
  if (start < 0) return undefined;
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return undefined;
}

/** The method and path of handler `name` in a file, and whether it is skipped */
function handler(file, name) {
  const src = readFileSync(file, "utf8");
  const at = src.search(new RegExp(`\\bfn ${name}\\s*[<(]`));
  if (at < 0) return undefined;
  // the attributes right above the function
  const before = src.slice(Math.max(0, at - 1500), at);
  const lastFn = before.lastIndexOf("fn ");
  const attributes =
    lastFn >= 0 ? before.slice(before.indexOf("\n", lastFn)) : before;
  const route = [
    ...attributes.matchAll(/#\[(get|post|put|patch|delete)\(\s*"([^"]*)"/g),
  ].at(-1);
  if (!route) return undefined;
  return {
    method: route[1],
    path: route[2],
    skip: /#\[openapi\(\s*skip\s*\)\]/.test(attributes),
  };
}

/** Every route of a group: its `routes()` list, resolved to handlers */
function groupRoutes(prefix, moduleParts, fnName) {
  const file = moduleFile(moduleParts);
  if (!file)
    throw new Error(`no module ${moduleParts.join("::")} for ${prefix}`);
  const src = readFileSync(file, "utf8");
  // `pub use admin::routes as admin_routes;` points to another module
  const alias = src.match(
    new RegExp(`pub use ([a-z_:]+)::([a-z_]+) as ${fnName};`),
  );
  if (alias)
    return groupRoutes(
      prefix,
      [...moduleParts, ...alias[1].split("::")],
      alias[2],
    );
  const body = functionBody(src, fnName);
  const list = body?.match(/openapi_get_routes_spec!\s*\[([\s\S]*?)\]/)?.[1];
  if (!list)
    throw new Error(
      `no openapi_get_routes_spec! in ${moduleParts.join("::")}::${fnName}`,
    );
  const out = [];
  for (const raw of list
    .split(",")
    .map((s) => s.replace(/\/\/[^\n]*/g, "").trim())
    .filter(Boolean)) {
    const parts = raw.split("::");
    const name = parts.pop();
    // `super::x::y` starts from the routes directory, the rest from the group
    const where =
      parts[0] === "super"
        ? parts.slice(1)
        : parts[0] === "crate"
          ? parts.slice(2)
          : [...moduleParts, ...parts];
    const handlerFile =
      moduleFile(where) ??
      (where.length === moduleParts.length ? file : undefined);
    const found = handlerFile && handler(handlerFile, name);
    if (!found) throw new Error(`handler ${raw} of ${prefix} not found`);
    out.push({ ...found, full: norm(prefix + "/" + found.path), source: raw });
  }
  return out;
}

export function backendRoutes() {
  const mod = readFileSync(join(routesDir, "mod.rs"), "utf8");
  // the first (webhooks on) table lists every group
  // `mount_endpoints_and_merged_docs!`, or the API's own copy of it
  const table = mod.match(
    /mount_endpoints_and_(?:merged|fixed)_docs!\s*\{([\s\S]*?)\};/,
  )?.[1];
  if (!table) throw new Error("no mount table in routes/mod.rs");
  const routes = [];
  for (const m of table.matchAll(
    /"([^"]*)"\s*=>\s*([a-z_:]+)::([a-z_]+)\(\)/g,
  )) {
    routes.push(...groupRoutes(m[1], m[2].split("::"), m[3]));
  }
  // routes listed in the table itself (`openapi_get_routes_spec![root::root, ...]`)
  for (const m of table.matchAll(
    /"([^"]*)"\s*=>\s*openapi_get_routes_spec!\[([^\]]*)\]/g,
  )) {
    for (const raw of m[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const parts = raw.split("::");
      const name = parts.pop();
      const found = handler(moduleFile(parts), name);
      if (found)
        routes.push({
          ...found,
          full: norm(m[1] + "/" + found.path),
          source: raw,
        });
    }
  }
  return routes;
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (isMain || process.argv[1]?.endsWith("check-backend-routes.mjs")) {
  const known = new Set();
  for (const m of readFileSync(
    join(root, "src/api/routes.ts"),
    "utf8",
  ).matchAll(/method: "(\w+)"; path: `[^`]*`; template: "([^"]*)"/g)) {
    known.add(`${m[1]} ${norm(m[2])}`);
  }

  const routes = backendRoutes().filter((r) => !r.skip);
  if (routes.length === 0) {
    console.error(`no routes found under ${routesDir}`);
    process.exit(2);
  }
  const missing = routes.filter(
    (r) =>
      !known.has(`${r.method} ${r.full}`) &&
      !OUTSIDE_DOCUMENT.has(`${r.method.toUpperCase()} ${r.full}`),
  );
  if (missing.length) {
    console.error(
      `The backend has ${missing.length} route(s) the SDK does not know. Run pnpm api:fetch, then pnpm api:generate:`,
    );
    for (const r of missing)
      console.error(`  ${r.method.toUpperCase()} ${r.full}  (${r.source})`);
    process.exit(1);
  }
  console.log(
    `SDK knows all ${routes.length} backend routes (full paths, mount prefixes included).`,
  );
}
