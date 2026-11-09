import { AsyncEventEmitter } from "@vladfrangu/async_event_emitter";
import { JSONParse, JSONStringify } from "json-with-bigint";

import type { Error as ApiErrorBody } from "../api/types.js";

import type { ProtocolV1 } from "./protocol.js";

/**
 * All possible connection states.
 */
export enum ConnectionState {
  Idle,
  Connecting,
  Connected,
  Disconnected,
}

/**
 * Gateway options
 */
export interface GatewayOptions {
  /**
   * Whether to log events
   * @default false
   */
  debug: boolean;

  /**
   * Time in seconds between Ping packets sent to the server
   * @default 30
   */
  heartbeatInterval: number;

  /**
   * Maximum time in seconds between Ping and corresponding Pong
   * @default 10
   */
  pongTimeout: number;

  /**
   * Maximum time in seconds between connecting and the first message
   * @default 10
   */
  connectTimeout: number;

  /**
   * Gateway intents a bot asks for (see `Intents`); the free ones when left out
   */
  intents?: number;

  /**
   * Reconnect after the connection drops: `false`, or the delay in
   * milliseconds before attempt `n` (0-based)
   * @default false
   */
  reconnect: false | ((attempt: number) => number);

  /**
   * Ask for a resumable session: after a drop, the reconnect first sends
   * `Resume` with the last `seq` seen and gets the missed events, then
   * `Resumed`. When the server can't resume (the session is gone, or too
   * much was missed) it answers `InvalidSession` and the gateway
   * authenticates anew: catch up over the API after that `Ready`.
   * @default false
   */
  resume: boolean;

  /**
   * WebSocket implementation (default: the global one)
   */
  WebSocket?: typeof WebSocket;
}

/** 1 s, 2 s, 4 s … up to 30 s, with jitter so many clients do not reconnect at once */
export function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
}

/** Close code: a privileged intent is not enabled for the bot; retrying won't help */
export const CLOSE_DISALLOWED_INTENTS = 4014;

/**
 * How many `InvalidSession` answers in a row make the gateway give up. One
 * refusal can be a server that is restarting (its session store is not back
 * yet), so the first ones are retried with backoff.
 */
export const INVALID_SESSION_LIMIT = 3;

/**
 * Events emitted by the gateway
 */
export type GatewayEvents = {
  error: [error: ApiErrorBody | Error | Event];
  /** A packet from the server (after `Ready`, and `Ready` itself) */
  event: [event: ProtocolV1["server"]];
  state: [state: ConnectionState];
  /** Round trip of the last heartbeat in milliseconds */
  ping: [ms: number];
  /** The socket closed with this code; `4014` stops reconnecting */
  close: [code: number, reason: string];
};

type Timer = ReturnType<typeof setTimeout>;

/** In Node the socket keeps the process alive, never the gateway's own timers */
function unref<T extends Timer>(timer: T): T {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

/**
 * WebSocket connection to the Zrzur gateway (protocol version 1, JSON).
 *
 * Authenticates with a message, so the token never goes into the URL;
 * sends heartbeats and drops the connection when the server stops
 * answering; can reconnect with exponential backoff.
 */
export class Gateway extends AsyncEventEmitter<GatewayEvents> {
  readonly options: GatewayOptions;

  #state = ConnectionState.Idle;
  #ping = -1;
  #attempt = 0;
  #closed = false;
  #invalidSessions = 0;
  #retrying = false;
  #target?: { uri: string; token: string };
  /** Resumable session from the last `Ready`, and the last `seq` seen */
  #session?: string;
  #seq = 0;
  /** Waiting for the missed events and `Resumed` */
  #resuming = false;

  #socket: WebSocket | undefined;
  #heartbeat: Timer | undefined;
  #pongTimeout: Timer | undefined;
  #connectTimeout: Timer | undefined;
  #reconnectTimeout: Timer | undefined;

  #lastError:
    | { type: "socket"; data: Event }
    | { type: "server"; data: ApiErrorBody }
    | { type: "protocol"; data: Error }
    | undefined;

  constructor(options?: Partial<GatewayOptions>) {
    super();
    this.options = {
      heartbeatInterval: 30,
      pongTimeout: 10,
      connectTimeout: 10,
      debug: false,
      reconnect: false,
      resume: false,
      ...options,
    };

    this.disconnect = this.disconnect.bind(this);
    this.dispose = this.dispose.bind(this);
    this.send = this.send.bind(this);
    this.connect = this.connect.bind(this);
    this.handle = this.handle.bind(this);
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this.#state;
  }

  /** Round trip of the last heartbeat in milliseconds, `-1` before the first */
  get ping(): number {
    return this.#ping;
  }

  /** Failed connection attempts since the last `Ready` */
  get attempt(): number {
    return this.#attempt;
  }

  /** Id of the resumable session, once `Ready` gave one */
  get sessionId(): string | undefined {
    return this.#session;
  }

  /** Sequence number of the last event received (0 before the first) */
  get seq(): number {
    return this.#seq;
  }

  /** Last error encountered by the gateway */
  get lastError() {
    return this.#lastError;
  }

  private setState(state: ConnectionState): void {
    this.#state = state;
    this.emit("state", state);
  }

  private clearTimers(): void {
    clearInterval(this.#heartbeat);
    clearTimeout(this.#connectTimeout);
    clearTimeout(this.#pongTimeout);
    clearTimeout(this.#reconnectTimeout);
    this.#heartbeat = undefined;
    this.#connectTimeout = undefined;
    this.#pongTimeout = undefined;
    this.#reconnectTimeout = undefined;
  }

  /**
   * Connect to the gateway.
   * @param uri WebSocket address, e.g. `wss://events.zrzur.com`
   * @param token Session or bot token
   */
  connect(uri: string, token: string): void {
    this.dispose();
    this.#closed = false;
    // a call from outside starts fresh; the reconnect timer keeps the count
    // and the session to resume
    if (!this.#retrying) {
      this.#invalidSessions = 0;
      this.#session = undefined;
      this.#seq = 0;
    }
    this.#retrying = false;
    const resume =
      this.options.resume && this.#session
        ? { session_id: this.#session, seq: this.#seq }
        : undefined;
    this.#resuming = Boolean(resume);
    this.#target = { uri, token };
    this.#lastError = undefined;
    this.setState(ConnectionState.Connecting);

    this.#connectTimeout = unref(
      setTimeout(() => this.disconnect(), this.options.connectTimeout * 1e3),
    );

    const url = new URL(uri);
    url.searchParams.set("version", "1");
    url.searchParams.set("format", "json");

    const Socket = this.options.WebSocket ?? WebSocket;
    const socket = (this.#socket = new Socket(url.toString()));

    socket.addEventListener("open", () => {
      if (this.#socket !== socket) return; // stale, a newer socket exists
      socket.send(
        JSONStringify(
          resume
            ? { type: "Resume", token, ...resume }
            : this.#authenticate(token),
        ),
      );
      this.#heartbeat = unref(
        setInterval(() => {
          this.send({ type: "Ping", data: Date.now() });
          clearTimeout(this.#pongTimeout);
          this.#pongTimeout = unref(
            setTimeout(() => this.disconnect(), this.options.pongTimeout * 1e3),
          );
        }, this.options.heartbeatInterval * 1e3),
      );
    });

    socket.addEventListener("error", (error) => {
      if (this.#socket !== socket) return;
      this.#lastError = { type: "socket", data: error };
      this.emit("error", error);
    });

    socket.addEventListener("message", (event) => {
      if (this.#socket !== socket) return;
      clearTimeout(this.#connectTimeout);
      if (typeof event.data !== "string") return;
      try {
        this.handle(JSONParse(event.data));
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        this.#lastError = { type: "protocol", data: error };
        this.disconnect();
        this.emit("error", error);
      }
    });

    let closed = false;
    socket.addEventListener("close", (event: CloseEvent) => {
      if (closed) return;
      closed = true;
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.clearTimers();
      this.emit("close", event?.code ?? 1006, event?.reason ?? "");
      if (event?.code === CLOSE_DISALLOWED_INTENTS) this.#closed = true;
      this.setState(ConnectionState.Disconnected);
      this.#scheduleReconnect();
    });
  }

  #authenticate(token: string): ProtocolV1["client"] {
    return {
      type: "Authenticate",
      token,
      ...(this.options.intents !== undefined
        ? { intents: this.options.intents }
        : {}),
      ...(this.options.resume ? { resumable: true } : {}),
    };
  }

  #scheduleReconnect() {
    const delay = this.options.reconnect;
    if (this.#closed || !delay || !this.#target) return;
    const { uri, token } = this.#target;
    this.#reconnectTimeout = unref(
      setTimeout(() => {
        this.#retrying = true;
        this.connect(uri, token);
      }, delay(this.#attempt++)),
    );
  }

  /**
   * Close the socket without changing state or reconnecting.
   */
  dispose(): void {
    clearTimeout(this.#reconnectTimeout);
    if (!this.#socket) return;
    this.clearTimers();
    const socket = this.#socket;
    this.#socket = undefined;
    socket.close();
  }

  /**
   * Drop the connection; reconnects when `reconnect` is set.
   */
  disconnect(): void {
    if (!this.#socket) return;
    this.dispose();
    this.setState(ConnectionState.Disconnected);
    this.#scheduleReconnect();
  }

  /**
   * Close for good: no reconnect until `connect()` is called again.
   */
  close(): void {
    this.#closed = true;
    this.dispose();
    if (this.#state !== ConnectionState.Idle) {
      this.setState(ConnectionState.Disconnected);
    }
  }

  /** Whether a packet can be sent now */
  get open(): boolean {
    return this.#socket?.readyState === 1;
  }

  /**
   * Send a packet to the server.
   */
  send(event: ProtocolV1["client"]): void {
    if (this.options.debug) console.debug("[C->S]", event);
    if (!this.#socket) throw new Error("Socket closed, trying to send.");
    this.#socket.send(JSONStringify(event));
  }

  /**
   * Handle packets meant for the connection before passing them along.
   */
  handle(event: ProtocolV1["server"]): void {
    if (this.options.debug) console.debug("[S->C]", event);
    const seq = (event as { seq?: unknown }).seq;
    if (typeof seq === "number" && seq > this.#seq) this.#seq = seq;
    switch (event.type) {
      case "Bulk":
        // several packets in one: handle each in order
        for (const item of event.v) this.handle(item);
        return;
      case "Ping":
        this.send({ type: "Pong", data: event.data });
        return;
      case "Pong":
        clearTimeout(this.#pongTimeout);
        this.#ping = Date.now() - event.data;
        this.emit("ping", this.#ping);
        return;
      case "InvalidSession": {
        // the session can't be resumed: authenticate anew on this socket
        this.#session = undefined;
        this.#seq = 0;
        this.#resuming = false;
        this.emit("event", event);
        if (this.#target) this.send(this.#authenticate(this.#target.token));
        return;
      }
      case "Error":
        this.#lastError = { type: "server", data: event.data };
        // a refused resume starts anew next time
        this.#session = undefined;
        this.#resuming = false;
        // a token the server keeps refusing stays refused: do not retry
        // forever, but one answer may come from a restarting server
        if (
          (event.data as { type?: string } | undefined)?.type ===
            "InvalidSession" &&
          ++this.#invalidSessions >= INVALID_SESSION_LIMIT
        ) {
          this.#closed = true;
        }
        this.disconnect();
        this.emit("error", event.data);
        return;
    }

    switch (this.#state) {
      case ConnectionState.Connecting:
        if (this.#resuming) {
          // the missed events, then Resumed
          this.emit("event", event);
          if (event.type === "Resumed") {
            this.#resuming = false;
            this.#attempt = 0;
            this.#invalidSessions = 0;
            this.setState(ConnectionState.Connected);
          }
        } else if (event.type === "Authenticated") {
          // no-op
        } else if (event.type === "Ready") {
          this.#attempt = 0;
          this.#invalidSessions = 0;
          this.#session = this.options.resume ? event.session_id : undefined;
          this.#seq = 0;
          this.emit("event", event);
          this.setState(ConnectionState.Connected);
        } else {
          throw new Error(`Received ${event.type} before Ready.`);
        }
        break;
      case ConnectionState.Connected:
        if (event.type === "Authenticated" || event.type === "Ready") {
          throw new Error(`Received ${event.type} while connected.`);
        }
        this.emit("event", event);
        break;
      default:
        throw new Error(`Received ${event.type} in state ${this.#state}.`);
    }
  }
}

/**
 * Gateway intents: what a bot receives. The first six are free; the last
 * three are privileged and must be switched on for the bot in the developer
 * portal first. Without `MessageContent` messages arrive without text,
 * embeds, files or components, except the bot's own, its DMs and messages
 * that mention it.
 */
export const Intents = {
  Servers: 1 << 0,
  ServerMessages: 1 << 1,
  DirectMessages: 1 << 2,
  Reactions: 1 << 3,
  VoiceStates: 1 << 4,
  Interactions: 1 << 5,
  /** Privileged */
  MessageContent: 1 << 10,
  /** Privileged */
  ServerMembers: 1 << 11,
  /** Privileged */
  Presence: 1 << 12,
  /** Every free intent (what the server uses when a bot sends none) */
  Default: (1 << 6) - 1,
} as const;

/** One number from a list of intents (or a number already) */
export function intentBits(intents: number | readonly number[]): number {
  return typeof intents === "number"
    ? intents
    : intents.reduce((all, bit) => all | bit, 0);
}
