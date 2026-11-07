export { ApiError, redact } from "../core/errors.js";

/** The interaction was already answered (locally or by the server) */
export class InteractionAlreadyRepliedError extends Error {
  constructor() {
    super("This interaction has already been acknowledged");
    this.name = "InteractionAlreadyRepliedError";
  }
}

/** `editReply`, `followUp` or `deleteReply` before the first answer */
export class InteractionNotRepliedError extends Error {
  constructor() {
    super("The reply to this interaction has not been sent or deferred");
    this.name = "InteractionNotRepliedError";
  }
}

/** A collector or `await…` ended without collecting anything */
export class InteractionCollectorError extends Error {
  constructor(readonly reason: string) {
    super(`Nothing was collected before the wait ended, reason: ${reason}`);
    this.name = "InteractionCollectorError";
  }
}
