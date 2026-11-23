import { type ComponentType, componentTypeOf } from "./component-builders.js";
import type { Interaction } from "./interaction.js";
import type { User } from "./types.js";

export interface CollectorOptions {
  /** Only this message's buttons and menus (an id, or the message the bot sent) */
  message?: string | { _id?: string; id?: string };
  /** Only interactions in this channel */
  channelId?: string;
  /** `"Component"` (the default) or `"ModalSubmit"` */
  interactionType?: "Component" | "ModalSubmit";
  /** A number (`ComponentType.Button`) or a name (`"Button"`) */
  componentType?: ComponentType | string;
  /** Return false to skip an interaction (it is not answered for you) */
  filter?: (
    interaction: Interaction,
    collected: Map<string, Interaction>,
  ) => boolean | Promise<boolean>;
  /** End after this many milliseconds */
  time?: number;
  /** End after this many milliseconds without a collected interaction */
  idle?: number;
  /** End after this many collected interactions */
  max?: number;
  /** End after this many distinct components were collected (same as max here) */
  maxComponents?: number;
  /** End after this many different people */
  maxUsers?: number;
}

type Listener = (...args: never[]) => unknown;

/**
 * The few EventEmitter methods collectors need, without Node's types. A
 * listener that throws, or returns a promise that rejects, never takes the
 * process down: the error goes to `report` (the bot's `onError`).
 */
class Emitter {
  #listeners = new Map<string, Set<Listener>>();
  /**
   * `once` wrappers by event and the listener they wrap, so `off(event,
   * listener)` finds them; the same listener can be `once` on two events
   */
  #wrapped = new Map<string, Map<Listener, Listener>>();

  constructor(
    protected readonly report: (error: unknown) => void = defaultReport,
  ) {}

  on(event: string, listener: Listener) {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(listener);
    return this;
  }
  once(event: string, listener: Listener) {
    const wrapped = ((...args: never[]) => {
      this.off(event, listener);
      return listener(...args);
    }) as Listener;
    let byListener = this.#wrapped.get(event);
    if (!byListener) this.#wrapped.set(event, (byListener = new Map()));
    byListener.set(listener, wrapped);
    return this.on(event, wrapped);
  }
  off(event: string, listener: Listener) {
    const set = this.#listeners.get(event);
    set?.delete(listener);
    const byListener = this.#wrapped.get(event);
    const wrapped = byListener?.get(listener);
    if (wrapped) {
      set?.delete(wrapped);
      byListener!.delete(listener);
      if (!byListener!.size) this.#wrapped.delete(event);
    }
    return this;
  }
  listenerCount(event: string) {
    return this.#listeners.get(event)?.size ?? 0;
  }
  emit(event: string, ...args: unknown[]) {
    const set = this.#listeners.get(event);
    if (event === "error" && !set?.size) {
      // nobody listens for errors here: the bot's onError gets it
      this.report(args[0]);
      return false;
    }
    for (const listener of [...(set ?? [])]) {
      try {
        const result = (listener as (...a: unknown[]) => unknown)(...args);
        if (result && typeof (result as Promise<unknown>).then === "function")
          (result as Promise<unknown>).then(undefined, (error) =>
            this.report(error),
          );
      } catch (error) {
        this.report(error);
      }
    }
    return !!set?.size;
  }
}

function defaultReport(error: unknown) {
  console.error("[@zrzur/sdk]", error);
}

/**
 * Collects button clicks, menu choices or forms. Events: `collect` (interaction), `ignore`
 * (interaction the filter skipped), `end` (collected, reason). Reasons:
 * `time`, `idle`, `limit`, `componentLimit`, `userLimit`, `messageDelete`,
 * `channelDelete`, `user` (stopped by you) or whatever you pass to `stop`.
 *
 * Collectors without `time` or `idle` run until stopped.
 */
export class InteractionCollector extends Emitter {
  readonly collected = new Map<string, Interaction>();
  readonly users = new Map<string, User>();
  readonly messageId: string | null;
  readonly channelId: string | null;
  total = 0;
  ended = false;
  endReason: string | null = null;
  #timer?: ReturnType<typeof setTimeout>;
  #idleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly options: CollectorOptions,
    private readonly onEnd: (collector: InteractionCollector) => void,
    /** Where errors of `collect`, `end` and `ignore` handlers go (the bot's `onError`) */
    report?: (error: unknown) => void,
  ) {
    super(report);
    const message = options.message;
    this.messageId =
      typeof message === "string"
        ? message
        : (message?._id ?? message?.id ?? null);
    this.channelId = options.channelId ?? null;
    this.resetTimer();
  }

  /** Restart the clocks, optionally with new values */
  resetTimer(options: { time?: number; idle?: number } = {}) {
    const time = options.time ?? this.options.time;
    const idle = options.idle ?? this.options.idle;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    if (time) this.#timer = setTimeout(() => this.stop("time"), time);
    if (idle) this.#idleTimer = setTimeout(() => this.stop("idle"), idle);
  }

  /** Whether an interaction belongs to this collector before the filter */
  #belongs(interaction: Interaction) {
    const raw = interaction.raw;
    if (raw.type !== (this.options.interactionType ?? "Component"))
      return false;
    if (this.messageId && raw.message_id !== this.messageId) return false;
    if (this.channelId && raw.channel_id !== this.channelId) return false;
    const wanted = this.options.componentType;
    if (wanted !== undefined && raw.component) {
      const type =
        typeof wanted === "number"
          ? componentTypeOf(raw.component.component_type)
          : raw.component.component_type;
      if (type !== wanted) return false;
    }
    return true;
  }

  /** Called by the bot for every interaction */
  async handle(interaction: Interaction) {
    if (this.ended || !this.#belongs(interaction)) return;
    let pass = true;
    if (this.options.filter) {
      try {
        pass = await this.options.filter(interaction, this.collected);
      } catch (error) {
        this.emit("error", error);
        return;
      }
    }
    if (this.ended) return;
    if (!pass) {
      this.emit("ignore", interaction);
      return;
    }
    this.total += 1;
    this.collected.set(interaction.id, interaction);
    this.users.set(interaction.user._id, interaction.user);
    this.emit("collect", interaction);
    // only the idle clock restarts; `time` keeps counting
    if (this.options.idle) {
      if (this.#idleTimer) clearTimeout(this.#idleTimer);
      this.#idleTimer = setTimeout(() => this.stop("idle"), this.options.idle);
    }
    this.checkEnd();
  }

  /** Why the collector would end now, if it should */
  get limitReason() {
    const { max, maxComponents, maxUsers } = this.options;
    if (max && this.total >= max) return "limit";
    if (maxComponents && this.collected.size >= maxComponents)
      return "componentLimit";
    if (maxUsers && this.users.size >= maxUsers) return "userLimit";
    return null;
  }

  checkEnd() {
    const reason = this.limitReason;
    if (reason) this.stop(reason);
    return !!reason;
  }

  stop(reason = "user") {
    if (this.ended) return;
    this.ended = true;
    this.endReason = reason;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.onEnd(this);
    this.emit("end", this.collected, reason);
  }

  /** The next collected interaction (or the end) as a promise */
  next(): Promise<Interaction> {
    return new Promise((resolve, reject) => {
      if (this.ended) return reject(new Error(this.endReason ?? "ended"));
      const onCollect = (interaction: Interaction) => {
        this.off("end", onEnd);
        resolve(interaction);
      };
      const onEnd = (_: unknown, reason: string) => {
        this.off("collect", onCollect);
        reject(new Error(reason));
      };
      // `off` removes a `once` listener by the function given to `once`
      this.once("collect", onCollect);
      this.once("end", onEnd);
    });
  }
}
