/**
 * `@zrzur/sdk/rpc`: tell the Zrzur desktop app what your game or app is
 * doing, so the person's friends see "Playing <your game>". Node.js only
 * (it uses a local named pipe or socket, nothing on the network).
 *
 * ```ts
 * import { ZrzurRpc } from "@zrzur/sdk/rpc";
 *
 * const rpc = new ZrzurRpc({ clientId: "my-game" });
 * await rpc.connect();
 * await rpc.setActivity({
 *   details: "Ranked match",
 *   state: "Round 3 of 12",
 *   timestamps: { start: Date.now() },
 * });
 * ```
 *
 * The desktop app checks every field again and the server checks it a
 * third time. The person decides: they can block your app in Settings →
 * Activity, and nothing is shown unless they share their activity.
 */
import { type Socket, connect as connectSocket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const MAX_PAYLOAD = 64 * 1024;

/** What your app is doing */
export type RpcActivity = {
  /** 0 Playing (default), 1 Streaming, 2 Listening, 3 Watching, 5 Competing */
  type?: 0 | 1 | 2 | 3 | 5;
  /** Shown name; the desktop uses the program's name when left out */
  name?: string;
  /** First line, at most 128 characters */
  details?: string;
  /** Second line, at most 128 characters */
  state?: string;
  /** Milliseconds (or seconds) since 1970 */
  timestamps?: { start?: number; end?: number };
  /** `https://` pictures only; shown through Zrzur's image proxy */
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  /** At most two `https://` links; people see a link warning first */
  buttons?: { label: string; url: string }[];
};

export type ZrzurRpcOptions = {
  /** A short name or id for your app: letters, digits, `.`, `_`, `-` */
  clientId: string;
  /** Wait this long for the desktop app (ms) */
  timeout?: number;
};

/** The pipe or socket of the desktop app, number `index` (0 to 9) */
export function pipePath(
  index: number,
  platform = process.platform,
  env = process.env,
): string {
  if (platform === "win32") return `\\\\?\\pipe\\zrzur-ipc-${index}`;
  const base =
    env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || tmpdir();
  return join(base, `zrzur-ipc-${index}`);
}

/** One frame: opcode and length (little endian), then JSON */
export function encodeFrame(op: number, data: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  if (body.length > MAX_PAYLOAD) throw new RangeError("activity too large");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** A connection to the Zrzur desktop app */
export class ZrzurRpc {
  readonly clientId: string;
  readonly #timeout: number;
  #socket?: Socket;
  #buffer = Buffer.alloc(0);
  #nonce = 0;
  #waiting = new Map<string, (frame: Record<string, unknown>) => void>();

  constructor(options: ZrzurRpcOptions) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(options.clientId))
      throw new TypeError("clientId: 1 to 64 letters, digits, '.', '_' or '-'");
    this.clientId = options.clientId;
    this.#timeout = options.timeout ?? 5000;
  }

  /** Find the desktop app and shake hands. Rejects when it is not running. */
  async connect(): Promise<void> {
    for (let index = 0; index < 10; index++) {
      const socket = await this.#open(pipePath(index));
      if (!socket) continue;
      this.#socket = socket;
      socket.on("data", (chunk) => this.#read(chunk));
      const ready = this.#expect("READY");
      socket.write(
        encodeFrame(OP_HANDSHAKE, { v: 1, client_id: this.clientId }),
      );
      await ready;
      return;
    }
    throw new Error("The Zrzur desktop app is not running");
  }

  /** Show this activity; `null` clears it */
  async setActivity(activity: RpcActivity | null): Promise<void> {
    const socket = this.#socket;
    if (!socket) throw new Error("connect() first");
    const nonce = String(++this.#nonce);
    const answer = this.#expect(nonce);
    socket.write(
      encodeFrame(OP_FRAME, {
        cmd: "SET_ACTIVITY",
        nonce,
        args: { pid: process.pid, activity },
      }),
    );
    const frame = await answer;
    if (frame.evt === "ERROR") {
      const data = (frame.data ?? {}) as { message?: string };
      throw new Error(data.message ?? "The desktop app refused the activity");
    }
  }

  /** Clear the activity and close */
  close(): void {
    const socket = this.#socket;
    this.#socket = undefined;
    if (!socket) return;
    socket.end(encodeFrame(OP_CLOSE, {}));
  }

  #open(path: string): Promise<Socket | undefined> {
    return new Promise((resolve) => {
      const socket = connectSocket(path);
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(undefined);
      }, this.#timeout);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("error", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  }

  #expect(key: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(key);
        reject(new Error("The Zrzur desktop app did not answer"));
      }, this.#timeout);
      this.#waiting.set(key, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }

  #read(chunk: Buffer) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    while (this.#buffer.length >= 8) {
      const length = this.#buffer.readUInt32LE(4);
      if (length > MAX_PAYLOAD) {
        this.close();
        return;
      }
      if (this.#buffer.length < 8 + length) return;
      const op = this.#buffer.readUInt32LE(0);
      const body = this.#buffer.subarray(8, 8 + length).toString("utf8");
      this.#buffer = this.#buffer.subarray(8 + length);
      if (op === OP_CLOSE) {
        this.#socket?.destroy();
        this.#socket = undefined;
        return;
      }
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(body);
      } catch {
        continue;
      }
      const key = frame.evt === "READY" ? "READY" : String(frame.nonce ?? "");
      this.#waiting.get(key)?.(frame);
      this.#waiting.delete(key);
    }
  }
}
