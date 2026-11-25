// The desktop RPC client speaks the local presence protocol.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";

import { ZrzurRpc, encodeFrame, pipePath } from "../../lib/rpc/index.js";

test("pipe paths and frames follow the protocol", () => {
  assert.equal(pipePath(3, "win32", {}), "\\\\?\\pipe\\zrzur-ipc-3");
  assert.match(pipePath(0, "linux", { XDG_RUNTIME_DIR: "/run/user/1000" }), /zrzur-ipc-0$/);
  const frame = encodeFrame(1, { a: 1 });
  assert.equal(frame.readUInt32LE(0), 1);
  assert.equal(frame.readUInt32LE(4), frame.length - 8);
  assert.throws(() => encodeFrame(1, { big: "x".repeat(70_000) }), RangeError);
  assert.throws(() => new ZrzurRpc({ clientId: "has spaces" }), TypeError);
});

test("the RPC client shakes hands and sets an activity on a desktop-like pipe", async (t) => {
  if (process.platform !== "win32") process.env.XDG_RUNTIME_DIR = (await import("node:os")).tmpdir();
  const frames = [];
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const length = buffer.readUInt32LE(4);
        if (buffer.length < 8 + length) return;
        const op = buffer.readUInt32LE(0);
        const data = JSON.parse(buffer.subarray(8, 8 + length).toString());
        buffer = buffer.subarray(8 + length);
        frames.push({ op, data });
        if (op === 0) socket.write(encodeFrame(1, { cmd: "DISPATCH", evt: "READY", data: { v: 1 } }));
        if (op === 1) socket.write(encodeFrame(1, { cmd: "SET_ACTIVITY", evt: null, nonce: data.nonce, data: data.args.activity }));
      }
    });
  });
  const path = pipePath(0);
  const listening = await new Promise((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(path, () => resolve(true));
  });
  if (!listening) {
    t.skip("pipe 0 is taken on this computer (a Zrzur desktop app runs)");
    return;
  }
  try {
    const rpc = new ZrzurRpc({ clientId: "test-game", timeout: 2000 });
    await rpc.connect();
    await rpc.setActivity({ details: "Ranked match", timestamps: { start: 1_700_000_000_000 } });
    rpc.close();
    assert.deepEqual(frames[0], { op: 0, data: { v: 1, client_id: "test-game" } });
    assert.equal(frames[1].data.cmd, "SET_ACTIVITY");
    assert.equal(frames[1].data.args.pid, process.pid);
    assert.equal(frames[1].data.args.activity.details, "Ranked match");
  } finally {
    server.close();
  }
});
