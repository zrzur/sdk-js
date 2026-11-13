/**
 * Error returned by the Zrzur API, with its error type (`UnknownUser`,
 * `MissingPermission`, `InteractionExpired`, ...). The fields of the server's
 * error body (`type`, `permission`, `max`, `retry_after`, ...) are on the
 * error itself.
 */
export class ApiError extends Error {
  /** HTTP status */
  readonly status: number;
  /**
   * Error type from the server (`ERROR_CODES` lists them), `Unknown` when the
   * body was not JSON or had none, as on a plain rate limit
   */
  readonly type: string;
  readonly method: string;
  /** Path of the request; interaction and webhook tokens are replaced by `***` */
  readonly path: string;
  /** Extra detail, e.g. which field failed validation or which permission is missing */
  readonly detail?: string;
  /** Milliseconds to wait before retrying, for 429 */
  readonly retryAfter?: number;
  /** The error body as the server sent it */
  readonly body: Record<string, unknown>;

  constructor(
    status: number,
    method: string,
    path: string,
    body: Record<string, unknown> = {},
    retryAfter?: number,
  ) {
    const type = typeof body.type === "string" ? body.type : "Unknown";
    const detail =
      (typeof body.error === "string" ? body.error : undefined) ??
      (body.permission ? `needs ${body.permission}` : undefined) ??
      (body.max !== undefined ? `max ${body.max}` : undefined);
    super(
      `${method} ${redact(path)} failed with ${status} ${type}${detail ? `: ${detail}` : ""}`,
    );
    Object.assign(this, body);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.method = method;
    // the error is often logged whole: no token may be among its fields
    this.path = redact(path);
    this.detail = detail;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

/** Interaction and webhook tokens must never end up in logs */
export function redact(path: string): string {
  return path.replace(/(\/(?:interactions|webhooks)\/[^/]+\/)[^/?]+/, "$1***");
}
