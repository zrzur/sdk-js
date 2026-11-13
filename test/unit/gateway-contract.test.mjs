// The hand-written gateway types (`src/core/protocol.ts`) against the
// server's published gateway schema (`api/gateway.schema.json`, the answer of
// `GET /gateway/schema`): every event the server can send is typed, with every
// field it carries, and every packet a client may send is typed too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = new URL("../../", import.meta.url);
const schema = JSON.parse(
  readFileSync(new URL("api/gateway.schema.json", root), "utf8"),
);

/** Members of a union type in protocol.ts: `type` literal → property names */
function unionOf(typeName) {
  const file = fileURLToPath(new URL("src/core/protocol.ts", root));
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const symbol = checker
    .getExportsOfModule(checker.getSymbolAtLocation(source))
    .find((s) => s.name === typeName);
  assert.ok(symbol, `${typeName} is exported`);
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const members = new Map();
  for (const member of type.isUnion() ? type.types : [type]) {
    const tag = member.getProperty("type");
    if (!tag) continue;
    const tagType = checker.getTypeOfSymbol(tag);
    for (const literal of tagType.isUnion() ? tagType.types : [tagType]) {
      if (!literal.isStringLiteral()) continue;
      const props = members.get(literal.value) ?? new Set();
      for (const p of member.getProperties()) props.add(p.name);
      members.set(literal.value, props);
    }
  }
  return members;
}

/** Variants of a schema union: `type` const → property names */
function variantsOf(node) {
  const out = new Map();
  const resolve = (n) =>
    n?.$ref ? resolve(node.definitions?.[n.$ref.split("/").pop()]) : n;
  const props = (n, into) => {
    n = resolve(n);
    if (!n) return;
    for (const key of Object.keys(n.properties ?? {})) into.add(key);
    for (const part of n.allOf ?? []) props(part, into);
  };
  const walk = (n) => {
    n = resolve(n);
    if (!n) return;
    for (const v of n.oneOf ?? n.anyOf ?? []) walk(v);
    const tag = resolve(n.properties?.type);
    const names = tag?.enum ?? (tag?.const ? [tag.const] : []);
    if (!names.length) return;
    const fields = new Set();
    props(n, fields);
    // serde bookkeeping that never travels
    fields.delete("responded");
    for (const name of names) {
      const known = out.get(name) ?? new Set();
      for (const f of fields) known.add(f);
      out.set(name, known);
    }
  };
  walk(node);
  return out;
}

function compare(typeName, node) {
  const typed = unionOf(typeName);
  const wire = variantsOf(node);
  assert.ok(wire.size > 5, `the schema lists packets (${wire.size})`);
  const problems = [];
  for (const [name, fields] of wire) {
    const known = typed.get(name);
    if (!known) {
      problems.push(`${name}: not typed`);
      continue;
    }
    for (const field of fields) {
      if (!known.has(field)) problems.push(`${name}.${field}: not typed`);
    }
  }
  return problems;
}

test("every event the server sends is typed with every field", () => {
  assert.deepEqual(compare("ServerMessage", schema.server), []);
});

test("every packet a client may send is typed with every field", () => {
  assert.deepEqual(compare("ClientMessage", schema.client), []);
});

test("the intents match the server's", async () => {
  const { Intents } = await import("../../lib/index.js");
  const upper = (name) =>
    name.replace(/(?<!^)[A-Z]/g, (letter) => "_" + letter).toUpperCase();
  const mine = Object.fromEntries(
    Object.entries(Intents)
      .filter(([name]) => name !== "Default")
      .map(([name, value]) => [upper(name), value]),
  );
  assert.deepEqual(mine, schema.intents);
  assert.equal(Intents.Default, schema.default_intents);
  assert.equal(
    Intents.MessageContent | Intents.ServerMembers | Intents.Presence,
    schema.privileged_intents,
  );
});
