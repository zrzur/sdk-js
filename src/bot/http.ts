/**
 * Receiving interactions over HTTP: checking Zrzur's signature and answering
 * its requests. Works with the standard `Request` and `Response`, so any
 * runtime or framework can use it; `serveInteractions` is a small Node server.
 */
import type { RawInteraction } from "./types.js";

export const HEADER_TIMESTAMP = "x-zrzur-timestamp";
export const HEADER_SIGNATURE = "x-zrzur-signature";
export const HEADER_DELIVERY = "x-zrzur-delivery";

/** How far a request's time may be from this machine's clock */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const MAX_BODY_BYTES = 1024 * 1024;
const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | undefined {
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return undefined;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Whether a request really comes from Zrzur and is recent. Pass the body
 * exactly as received, before parsing it. The comparison takes the same time
 * wherever the signature differs.
 */
export async function verifySignature(options: {
  secret: string;
  /** Value of `X-Zrzur-Timestamp` */
  timestamp: string | null;
  /** Value of `X-Zrzur-Signature` */
  signature: string | null;
  body: string | Uint8Array;
  /** Seconds since the epoch; for tests */
  now?: number;
}) {
  const { secret, timestamp, signature, body } = options;
  if (!timestamp || !signature?.startsWith("v1=")) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const given = hexToBytes(signature.slice(3));
  if (!given) return false;

  const prefix = encoder.encode(`v1:${timestamp}:`);
  const raw = typeof body === "string" ? encoder.encode(body) : body;
  const message = new Uint8Array(prefix.length + raw.length);
  message.set(prefix);
  message.set(raw, prefix.length);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, given, message);
}

/**
 * Remembers interactions for as long as their signature stays valid, so a
 * captured request can't be sent twice. Keep it on the `_id` from the signed
 * body: the `X-Zrzur-Delivery` header is not signed, anyone can change it.
 */
export class DeliveryLog {
  #seen = new Map<string, number>();

  /** True the first time an id is seen */
  first(id: string, now = Date.now()) {
    for (const [known, until] of this.#seen) {
      // entries are in time order
      if (until > now) break;
      this.#seen.delete(known);
    }
    if (this.#seen.has(id)) return false;
    this.#seen.set(id, now + SIGNATURE_TOLERANCE_SECONDS * 2000);
    return true;
  }
}

export interface InteractionHandlerOptions {
  /** Signing secret of the bot; read it from the environment */
  secret: string;
}

/**
 * A handler for Zrzur's requests: refuses what is not signed, answers `Ping`,
 * passes each interaction once to `deliver`, and says 202 (the answer goes
 * through the callback route, as with the gateway).
 */
export function createInteractionHandler(
  options: InteractionHandlerOptions,
  deliver: (interaction: RawInteraction) => void,
) {
  const deliveries = new DeliveryLog();
  return async (request: Request): Promise<Response> => {
    const body = await request.text();
    const valid = await verifySignature({
      secret: options.secret,
      timestamp: request.headers.get(HEADER_TIMESTAMP),
      signature: request.headers.get(HEADER_SIGNATURE),
      body,
    });
    if (!valid) return new Response(null, { status: 401 });

    let packet: { type?: string; _id?: string };
    try {
      packet = JSON.parse(body) as typeof packet;
    } catch {
      return new Response(null, { status: 400 });
    }
    if (packet.type === "Ping") return Response.json({ type: "Pong" });

    // the id inside the signed body: the delivery header is not signed
    if (!packet._id || !deliveries.first(packet._id)) {
      return new Response(null, { status: 409 });
    }
    deliver(packet as RawInteraction);
    return new Response(null, { status: 202 });
  };
}

/** Serve a handler on a port with Node's own HTTP server */
export async function serveInteractions(
  handler: (request: Request) => Promise<Response>,
  options: { port: number; hostname?: string; path?: string },
) {
  const { createServer } = process.getBuiltinModule("node:http");
  const path = options.path ?? "/interactions";
  const server = createServer((incoming, outgoing) => {
    const finish = (status: number, body?: string) => {
      outgoing.statusCode = status;
      if (body) outgoing.setHeader("Content-Type", "application/json");
      outgoing.end(body);
    };
    if (incoming.method !== "POST" || incoming.url?.split("?")[0] !== path) {
      finish(404);
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    incoming.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(413);
        incoming.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    incoming.on("end", () => {
      const headers = new Headers();
      for (const name of [
        HEADER_TIMESTAMP,
        HEADER_SIGNATURE,
        HEADER_DELIVERY,
      ]) {
        const value = incoming.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      handler(
        new Request("http://localhost" + path, {
          method: "POST",
          headers,
          body: Buffer.concat(chunks),
        }),
      )
        .then(async (response) =>
          finish(response.status, await response.text()),
        )
        .catch(() => finish(500));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.hostname, resolve);
  });
  return server;
}
