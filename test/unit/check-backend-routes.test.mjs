// The route checker reads the mount prefix of each group: a route whose tail
// matches another group's route (/users/{id}/members vs /servers/{id}/members) is
// still reported as missing. It passed such routes before.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../../scripts/check-backend-routes.mjs", import.meta.url),
);

function fakeBackend(files) {
  const dir = mkdtempSync(join(tmpdir(), "zrzur-routes-"));
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, "crates/delta/src/routes", path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

const mod = (groups) => `
pub fn mount(config: Settings, mut rocket: Rocket<Build>) -> Rocket<Build> {
    if config.features.webhooks_enabled {
        mount_endpoints_and_merged_docs! {
            rocket, "/".to_owned(), settings,
            "/" => (vec![], custom_openapi_spec()),
${groups.map(([prefix, call]) => `            "${prefix}" => ${call.includes("(") ? call : `${call}::routes()`},`).join("\n")}
        };
    }
}`;

const group = (handlers) => `
pub fn routes() -> (Vec<Route>, OpenApi) {
    openapi_get_routes_spec![
${handlers.map((h) => `        ${h},`).join("\n")}
    ]
}`;

function run(dir) {
  return spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
}

test("a route is checked with its mount prefix, not by its tail", () => {
  const dir = fakeBackend({
    "mod.rs": mod([["/users", "users"]]),
    "users/mod.rs": group(["saved::list"]),
    // GET /users/{id}/members is not a route; its tail "/{id}/members" is
    // (GET /servers/{target}/members), which the old tail match accepted
    "users/saved.rs": `#[openapi(tag = "Saved")]\n#[get("/<target>/members")]\npub async fn list() {}`,
  });
  const result = run(dir);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /GET \/users\/\{\}\/members/);
});

test("known routes pass, skipped handlers are left out, aliases are followed", () => {
  const dir = fakeBackend({
    "mod.rs": mod([
      ["/users", "users"],
      ["/admin", "community::admin_routes()"],
    ]),
    "users/mod.rs": group(["fetch_self::fetch", "hidden::secret"]),
    "users/fetch_self.rs": `#[openapi(tag = "User Information")]\n#[get("/@me")]\npub async fn fetch() {}`,
    "users/hidden.rs": `#[openapi(skip)]\n#[get("/@me/secret")]\npub async fn secret() {}`,
    "community/mod.rs": "pub use admin::routes as admin_routes;",
    "community/admin.rs":
      group(["permissions"]) +
      `\n#[openapi(tag = "Admin")]\n#[post("/permissions")]\npub async fn permissions() {}`,
  });
  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /all 2 backend routes/);
});

test("no routes at all is a failure, never a pass", () => {
  const dir = fakeBackend({ "mod.rs": "pub fn mount() {}" });
  assert.notEqual(run(dir).status, 0);
});
