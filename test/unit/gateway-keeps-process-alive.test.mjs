// A bot whose connection drops must stay alive until it has reconnected: the
// wait before a reconnect is the only thing the process is doing then.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const lib = new URL("../../lib/index.js", import.meta.url).href;

function run(body) {
  const script = `
    import { Gateway } from ${JSON.stringify(lib)};
    let sockets = 0;
    class DroppingSocket extends EventTarget {
      readyState = 0;
      constructor() {
        super();
        sockets += 1;
        console.log("socket " + sockets);
        // the first connection drops right after it opens
        if (sockets === 1) {
          queueMicrotask(() => {
            this.readyState = 3;
            const event = new Event("close");
            event.code = 1006;
            event.reason = "";
            this.dispatchEvent(event);
          });
        }
      }
      send() {}
      close() {}
    }
    const gateway = new Gateway({ WebSocket: DroppingSocket, reconnect: () => 200 });
    gateway.on("error", () => {});
    ${body}
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 10_000,
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
  });
}

test("the process stays alive while the gateway waits to reconnect", () => {
  const result = run(`
    gateway.on("state", () => {
      // stop once the second connection was attempted, so the test ends
      if (sockets === 2) gateway.close();
    });
    gateway.connect("ws://127.0.0.1:1", "token");
  `);
  assert.match(result.stdout, /socket 1\n/);
  assert.match(
    result.stdout,
    /socket 2\n/,
    "the process exited before the reconnect happened",
  );
  assert.equal(result.status, 0);
});

test("after close() nothing keeps the process alive", () => {
  const started = Date.now();
  const result = run(`
    gateway.on("close", () => gateway.close());
    gateway.connect("ws://127.0.0.1:1", "token");
  `);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /socket 2/);
  assert.ok(Date.now() - started < 5000);
});
