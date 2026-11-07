// Media proxy tickets: added to proxied addresses, kept fresh, and the app
// keeps working on a server without the route.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "../../lib/solid/index.js";
import { proxiedImageURL } from "../../lib/solid/lib/proxy.js";
import { ProxyTicketKeeper } from "../../lib/solid/lib/proxyTicket.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the ticket goes on proxied addresses only, encoded", () => {
  const proxy = "https://proxy.test";
  const own = "https://cdn.test";
  assert.equal(
    proxiedImageURL("https://a.test/x.png", proxy, own, "1.u+1.abc"),
    "https://proxy.test/proxy?url=https%3A%2F%2Fa.test%2Fx.png&t=1.u%2B1.abc",
  );
  assert.equal(
    proxiedImageURL("https://a.test/x.png", proxy, own),
    "https://proxy.test/proxy?url=https%3A%2F%2Fa.test%2Fx.png",
  );
  assert.equal(
    proxiedImageURL("https://cdn.test/x.png", proxy, own, "ticket"),
    "https://cdn.test/x.png",
  );
});

test("reading never waits, and many readers ask once", async () => {
  let asked = 0;
  const keeper = new ProxyTicketKeeper(
    async () => (asked++, { ticket: "one", expires_at: 1000 + 3600 }),
    undefined,
    () => 1000,
  );
  assert.equal(keeper.current(), undefined);
  assert.equal(keeper.current(), undefined);
  await settle();
  assert.equal(asked, 1);
  assert.equal(keeper.current(), "one");
  await settle();
  assert.equal(asked, 1);
});

test("a ticket about to end is replaced, and is used until then", async () => {
  let now = 1000;
  const tickets = ["one", "two"];
  const keeper = new ProxyTicketKeeper(
    async () => ({ ticket: tickets.shift(), expires_at: now + 3600 }),
    undefined,
    () => now,
  );
  keeper.current();
  await settle();
  now += 3600 - 60;
  assert.equal(keeper.current(), "one");
  await settle();
  assert.equal(keeper.current(), "two");
});

test("an ended ticket is not used", async () => {
  let now = 1000;
  const keeper = new ProxyTicketKeeper(
    async () => {
      if (now > 1000) throw new Error("offline");
      return { ticket: "one", expires_at: now + 3600 };
    },
    undefined,
    () => now,
  );
  keeper.current();
  await settle();
  now += 4000;
  assert.equal(keeper.current(), undefined);
});

test("a failure waits before asking again", async () => {
  let now = 1000;
  let asked = 0;
  const keeper = new ProxyTicketKeeper(
    async () => {
      asked++;
      throw new Error("no such route");
    },
    undefined,
    () => now,
  );
  keeper.current();
  await settle();
  keeper.current();
  await settle();
  assert.equal(asked, 1);
  now += 301;
  keeper.current();
  await settle();
  assert.equal(asked, 2);
});

function client(answer) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input);
    calls.push({ url, method: init?.method ?? input?.method });
    return answer(url);
  };
  const c = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  c.configuration = {
    features: {
      january: { enabled: true, url: "https://proxy.test" },
      autumn: { url: "https://cdn.test" },
    },
  };
  return { c, calls, restore: () => (globalThis.fetch = realFetch) };
}

const session = { _id: "S", token: "T", user_id: "U" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

test("an app session gets a ticket and proxyFile uses it", async () => {
  const { c, calls, restore } = client(() =>
    json({ ticket: "abc", expires_at: Date.now() / 1000 + 3600 }),
  );
  try {
    assert.equal(
      c.proxyFile("https://a.test/x.png"),
      "https://proxy.test/proxy?url=https%3A%2F%2Fa.test%2Fx.png",
    );
    c.useExistingSession(session);
    await settle();
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].url.endsWith("/auth/session/proxy_ticket"), calls[0].url);
    assert.ok(c.proxyFile("https://a.test/x.png").endsWith("&t=abc"));
  } finally {
    restore();
  }
});

test("a server without the route leaves addresses as they were", async () => {
  const { c, restore } = client(() => json({ type: "NotFound" }, 404));
  try {
    c.useExistingSession(session);
    await settle();
    await settle();
    assert.equal(
      c.proxyFile("https://a.test/x.png"),
      "https://proxy.test/proxy?url=https%3A%2F%2Fa.test%2Fx.png",
    );
  } finally {
    restore();
  }
});
