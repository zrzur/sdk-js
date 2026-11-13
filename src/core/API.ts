import { JSONParse, JSONStringify } from "json-with-bigint";

import { pathResolve, queryParams } from "../api/params.js";
import type { APIRoutes } from "../api/routes.js";

import { ApiError } from "./errors.js";

export type { APIRoutes } from "../api/routes.js";

type Methods = APIRoutes["method"];
type PickRoutes<Method extends Methods> = APIRoutes & { method: Method };

type Count<
  Str extends string,
  SubStr extends string,
  Matches extends null[] = [],
> = Str extends `${infer _}${SubStr}${infer After}`
  ? Count<After, SubStr, [...Matches, null]>
  : Matches["length"];

/** Members of `R` whose template is strictly narrower than `W`'s */
type Narrower<
  R extends { path: string },
  W extends { path: string },
> = R extends unknown
  ? R["path"] extends W["path"]
    ? W["path"] extends R["path"]
      ? never
      : R
    : never
  : never;

/** Keep the most specific templates: `/servers/${string}/ack` wins over `/servers/${string}/${string}` */
type MostSpecific<
  R extends { path: string },
  All extends { path: string } = R,
> = R extends unknown
  ? [Narrower<All, R>] extends [never]
    ? R
    : never
  : never;

/** The route a concrete path such as `/users/01H…` belongs to */
export type RouteOf<Method extends Methods, Path extends string> = MostSpecific<
  Matching<PickRoutes<Method>, Path>
>;

/** Members of `R` whose template accepts `Path` with the same number of segments */
type Matching<
  R extends { path: string; parts: number },
  Path extends string,
> = R extends unknown
  ? Path extends R["path"]
    ? Count<Path, "/"> extends R["parts"]
      ? R
      : never
    : never
  : never;

/** Parameters are optional when the route takes none or only optional ones */
type Args<Params> = [Params] extends [undefined]
  ? [params?: undefined, config?: RequestOptions]
  : undefined extends Params
    ? [params?: Params, config?: RequestOptions]
    : object extends Params
      ? [params?: Params, config?: RequestOptions]
      : [params: Params, config?: RequestOptions];

/**
 * Template of a concrete path (`/users/01H…` → `/users/{target}`), or
 * `undefined` when the API has no such route.
 */
export function getPathName(anyPath: string): string | undefined {
  const segments = anyPath.split("?")[0].split("/").slice(1);
  for (const shape of pathResolve[segments.length.toString()] ?? []) {
    if (shape.every((part, i) => Array.isArray(part) || part === segments[i])) {
      return (
        "/" +
        shape
          .map((part, i) => (Array.isArray(part) ? part[0] : segments[i]))
          .join("/")
      );
    }
  }
}

/**
 * Client configuration options
 */
export interface APIOptions {
  /** Address of the API, e.g. `https://api.zrzur.com`. Required: there is no default host. */
  baseURL: string;
  /** How requests authenticate */
  authentication?: {
    /** Session token of a signed-in account (`X-Session-Token`) */
    session?: string;
    /** Bot token (`X-Bot-Token`) */
    bot?: string;
    /** Any other headers, e.g. for the staff API */
    headers?: Record<string, string>;
  };
  /** Headers sent with every request */
  headers?: Record<string, string>;
  /** Retries after a short 429 (default 2); longer limits throw `ApiError` */
  maxRetries?: number;
  /** Custom fetch (tests, proxies) */
  fetch?: typeof fetch;
}

/**
 * Request options
 */
export interface RequestOptions {
  /** The base URL used for this request */
  baseURL?: string;
  /** The type of response given (default `json`) */
  responseType?: "blob" | "json" | "text" | "arrayBuffer";
  /** Headers to apply for this request */
  headers?: Record<string, string>;
  /** Send this exact body (e.g. `FormData`) instead of the JSON parameters */
  body?: BodyInit;
  /** Leave out the authentication headers */
  anonymous?: boolean;
  /** Extra query parameters (for routes that take a body and a query) */
  query?: Record<string, string | number | boolean>;
  /** Retries after a short 429 for this request (e.g. 0 for a report that must not be sent twice) */
  retries?: number;
  /** Cancel the request (e.g. autocomplete while typing) */
  signal?: AbortSignal;
}

/**
 * HTTP client for the Zrzur API. Every path and its parameters and response
 * are typed from the server's OpenAPI document (`src/api/`).
 *
 * Waits out short rate limits, and after a global 429 pauses every request
 * until the limit resets. Failed requests throw {@link ApiError}.
 */
export class API {
  readonly baseURL: string;
  #authentication: NonNullable<APIOptions["authentication"]>;
  readonly #headers: Record<string, string>;
  readonly #maxRetries: number;
  readonly #fetch: typeof fetch;

  /** Until when every request waits after the global limit (ms since epoch) */
  #pausedUntil = 0;

  constructor(options: APIOptions) {
    if (!options?.baseURL) {
      throw new Error("Zrzur: API baseURL is not configured.");
    }
    this.baseURL = options.baseURL.replace(/\/$/, "");
    this.#authentication = options.authentication ?? {};
    this.#headers = options.headers ?? {};
    this.#maxRetries = options.maxRetries ?? 2;
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
  }

  /**
   * Change how requests authenticate (e.g. after signing in, or
   * `client.login(token)` of a bot)
   */
  authenticate(authentication: APIOptions["authentication"] = {}): void {
    this.#authentication = authentication;
  }

  /** Authentication headers of this client */
  get auth(): Record<string, string> {
    const { session, bot, headers } = this.#authentication;
    if (session) return { "x-session-token": session };
    if (bot) return { "x-bot-token": bot };
    return headers ?? {};
  }

  /** Headers sent with every request (authentication included) */
  get config(): RequestOptions {
    return {
      baseURL: this.baseURL,
      headers: { ...this.auth, ...this.#headers },
    };
  }

  /**
   * Send a request to any route.
   * @param method HTTP method
   * @param path Path, e.g. `/users/${id}`
   * @param params Body and query parameters (each goes where the route expects it)
   * @param config Request options
   */
  async req<
    Method extends Methods,
    Path extends PickRoutes<Method>["path"],
    Route extends { params: unknown; response: unknown } = RouteOf<
      Method,
      Path
    >,
  >(
    method: Method,
    path: Path,
    params?: Route["params"],
    config?: RequestOptions,
  ): Promise<Route["response"]> {
    return this.#send(method, path, params, config) as Promise<
      Route["response"]
    >;
  }

  /**
   * Send a request to a route that is not in the public API document, such
   * as the staff API. Same headers, rate limits and errors as every other
   * request; nothing is typed.
   * @param method HTTP method
   * @param path Path, e.g. `/staff/me`
   * @param params Body (query parameters for `get`)
   * @param config Request options
   */
  raw<T = unknown>(
    method: Methods,
    path: string,
    params?: unknown,
    config?: RequestOptions,
  ): Promise<T> {
    return this.#send(method, path, params, config) as Promise<T>;
  }

  async #send(
    method: Methods,
    path: string,
    params: unknown,
    config: RequestOptions | undefined,
  ): Promise<unknown> {
    assertPlainPath(path);
    const query = new URLSearchParams();
    // a route whose body is a list (e.g. replacing every command) gets it as is
    const listBody = Array.isArray(params) ? params : undefined;
    for (const [key, value] of Object.entries(config?.query ?? {})) {
      query.append(key, String(value));
    }
    const body: Record<string, unknown> = {};
    const named = getPathName(path);
    const allowedQuery = named ? queryParams[named]?.[method] : undefined;

    if (params && typeof params === "object" && !listBody) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (allowedQuery?.includes(key) || method === "get") {
          for (const item of Array.isArray(value) ? value : [value]) {
            query.append(key, String(item));
          }
        } else {
          body[key] = value;
        }
      }
    }

    const search = query.toString();
    const url =
      (path.startsWith("/") ? (config?.baseURL ?? this.baseURL) : "") +
      path +
      (search ? (path.includes("?") ? "&" : "?") + search : "");

    // every non-GET request carries a JSON body (`{}` when empty): the
    // server's `Json<T>` guards reject a request without one
    const hasJsonBody = config?.body === undefined && method !== "get";

    const headers: Record<string, string> = {
      ...(config?.anonymous ? this.#headers : this.config.headers),
      ...(hasJsonBody ? { "content-type": "application/json" } : {}),
      ...config?.headers,
    };

    const route = routeKey(method, path);
    for (let attempt = 0; ; attempt++) {
      await this.#waitForGlobal();
      await this.#waitForBucket(route);
      const response = await this.#fetch(url, {
        method: method.toUpperCase(),
        headers,
        signal: config?.signal,
        body:
          config?.body ??
          (hasJsonBody ? JSONStringify(listBody ?? body) : undefined),
      });

      this.#noteBucket(route, response);
      if (response.ok) {
        const type = config?.responseType ?? "json";
        if (type !== "json") return await response[type]();
        const text = response.status === 204 ? "" : await response.text();
        return text ? JSONParse(text) : undefined;
      }

      let errorBody: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(await response.text());
        if (parsed && typeof parsed === "object") errorBody = parsed;
      } catch {
        // not JSON
      }
      // the body's `retry_after` (ms) counts when the headers are not
      // readable, as in a browser that is not shown them
      const retryAfter =
        retryAfterOf(response) ??
        (typeof errorBody.retry_after === "number" && errorBody.retry_after > 0
          ? errorBody.retry_after
          : undefined);
      if (
        await this.#waitOut(
          response,
          retryAfter,
          attempt < (config?.retries ?? this.#maxRetries),
          errorBody,
        )
      ) {
        continue;
      }
      throw new ApiError(
        response.status,
        method.toUpperCase(),
        url.startsWith("http") ? new URL(url).pathname : path,
        errorBody,
        retryAfter,
      );
    }
  }

  /** Send HTTP GET request */
  get<
    Path extends PickRoutes<"get">["path"],
    Route extends { params: unknown; response: unknown } = RouteOf<"get", Path>,
  >(path: Path, ...args: Args<Route["params"]>): Promise<Route["response"]> {
    return this.req("get", path, ...(args as [Route["params"]]));
  }

  /** Send HTTP POST request */
  post<
    Path extends PickRoutes<"post">["path"],
    Route extends { params: unknown; response: unknown } = RouteOf<
      "post",
      Path
    >,
  >(path: Path, ...args: Args<Route["params"]>): Promise<Route["response"]> {
    return this.req("post", path, ...(args as [Route["params"]]));
  }

  /** Send HTTP PUT request */
  put<
    Path extends PickRoutes<"put">["path"],
    Route extends { params: unknown; response: unknown } = RouteOf<"put", Path>,
  >(path: Path, ...args: Args<Route["params"]>): Promise<Route["response"]> {
    return this.req("put", path, ...(args as [Route["params"]]));
  }

  /** Send HTTP PATCH request */
  patch<
    Path extends PickRoutes<"patch">["path"],
    Route extends { params: unknown; response: unknown } = RouteOf<
      "patch",
      Path
    >,
  >(path: Path, ...args: Args<Route["params"]>): Promise<Route["response"]> {
    return this.req("patch", path, ...(args as [Route["params"]]));
  }

  /** Send HTTP DELETE request */
  delete<
    Path extends PickRoutes<"delete">["path"],
    Route extends { params: unknown; response: unknown } = RouteOf<
      "delete",
      Path
    >,
  >(path: Path, ...args: Args<Route["params"]>): Promise<Route["response"]> {
    return this.req("delete", path, ...(args as [Route["params"]]));
  }

  #filesUrl?: Promise<string>;

  /** Address of the file service, read once from the API root */
  filesUrl(): Promise<string> {
    this.#filesUrl ??= this.get("/")
      .then((root) => {
        const url = root.features?.autumn?.url;
        if (!url) throw new Error("This server has no file service");
        return url.replace(/\/$/, "");
      })
      .catch((error: unknown) => {
        // do not remember a failure: the next upload asks again
        this.#filesUrl = undefined;
        throw error;
      });
    return this.#filesUrl;
  }

  /**
   * Upload bytes to a file-service tag (`attachments`, `emojis`, `icons`,
   * `banners`, `avatars`, …); returns the file id to use in the API.
   */
  async uploadFile(
    tag: string,
    data: Blob | ArrayBuffer | Uint8Array,
    name = "file",
    type = "application/octet-stream",
  ): Promise<string> {
    const blob =
      data instanceof Blob ? data : new Blob([data as BlobPart], { type });
    const form = new FormData();
    form.append("file", blob, name);
    return (await this.upload(`${await this.filesUrl()}/${tag}`, form)).id;
  }

  /** Upload a form to the file service (`url` is its tag endpoint, e.g. `…/emojis`) */
  async upload(url: string, form: FormData): Promise<{ id: string }> {
    for (let attempt = 0; ; attempt++) {
      await this.#waitForGlobal();
      const response = await this.#fetch(url, {
        method: "POST",
        headers: this.auth,
        body: form,
      });
      const text = await response.text();
      // uploads wait 1 s when the file service names no time
      const retryAfter = retryAfterOf(response) ?? 1000;
      let uploadBody: Record<string, unknown> = {};
      try {
        uploadBody = JSON.parse(text) ?? {};
      } catch {
        // not JSON
      }
      if (
        await this.#waitOut(
          response,
          retryAfter,
          attempt < this.#maxRetries,
          uploadBody,
        )
      ) {
        continue;
      }
      if (!response.ok) {
        let body: Record<string, unknown> = { type: "UploadFailed" };
        try {
          body = JSON.parse(text);
        } catch {
          // not JSON
        }
        throw new ApiError(
          response.status,
          "POST",
          new URL(url).pathname,
          body,
          retryAfter,
        );
      }
      return JSON.parse(text);
    }
  }

  /** Fetch a file from the file service */
  async download(url: string): Promise<ArrayBuffer> {
    const response = await this.#fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }
    return response.arrayBuffer();
  }

  /**
   * After a 429: note a global limit (every request then waits for it), and
   * wait before a retry when one is allowed and the wait is short.
   * @returns Whether to send the request again
   */
  async #waitOut(
    response: Response,
    retryAfter: number | undefined,
    mayRetry: boolean,
    body: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (response.status !== 429 || !retryAfter) return false;
    // a typed 429 (e.g. `InSlowmode`) is a refusal the caller must see at
    // once; only a plain rate limit (`{retry_after}` without `type`) is waited out
    if (typeof body.type === "string") return false;
    // the body says it too, for clients that can't read the headers
    const global =
      response.headers.get("x-ratelimit-global") === "true" ||
      body.global === true;
    if (global) {
      // capped, so a wrong header can not freeze a bot for hours
      this.#pausedUntil = Math.max(
        this.#pausedUntil,
        Date.now() + Math.min(retryAfter, MAX_WAIT) + 50,
      );
    }
    if (!mayRetry || retryAfter > MAX_WAIT) return false;
    // a global limit is waited out at the top of the next attempt, in the
    // order the requests were made
    if (!global) await sleep(retryAfter + 50);
    return true;
  }

  /** Rate-limit bucket of each route, as the server named it */
  #bucketOf = new Map<string, string>();
  /** Buckets with no request left, until when (ms since epoch) */
  #emptyUntil = new Map<string, number>();

  /** Routes whose bucket is known (bounded) */
  knownRoutes(): number {
    return this.#bucketOf.size;
  }

  /** Remember a route's bucket, and whether it has requests left */
  #noteBucket(route: string, response: Response) {
    const bucket = response.headers.get("x-ratelimit-bucket");
    if (!bucket) return;
    // most recently used last; the oldest goes past the cap
    this.#bucketOf.delete(route);
    this.#bucketOf.set(route, bucket);
    if (this.#bucketOf.size > MAX_ROUTES) {
      this.#bucketOf.delete(this.#bucketOf.keys().next().value as string);
    }
    if (this.#emptyUntil.size > MAX_ROUTES) this.#emptyUntil.clear();
    const remaining = response.headers.get("x-ratelimit-remaining");
    const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"));
    if (remaining === "0" && resetAfter > 0) {
      this.#emptyUntil.set(bucket, Date.now() + Math.min(resetAfter, MAX_WAIT));
    } else {
      this.#emptyUntil.delete(bucket);
    }
  }

  /** Wait until a route's bucket has a request again, instead of a 429 */
  async #waitForBucket(route: string) {
    const bucket = this.#bucketOf.get(route);
    if (!bucket) return;
    const wait = (this.#emptyUntil.get(bucket) ?? 0) - Date.now();
    if (wait > 0) await sleep(wait + 50);
    this.#emptyUntil.delete(bucket);
  }

  /** Milliseconds every request still waits because of a global limit */
  pausedFor(): number {
    return Math.max(0, this.#pausedUntil - Date.now());
  }

  /** One wait shared by every request during a global pause */
  #pause?: { until: number; over: Promise<unknown> };

  /** Wait out a global pause; requests go on in the order they arrived */
  async #waitForGlobal() {
    while (this.#pausedUntil > Date.now()) {
      if (this.#pause?.until !== this.#pausedUntil) {
        this.#pause = {
          until: this.#pausedUntil,
          over: sleep(this.#pausedUntil - Date.now()),
        };
      }
      await this.#pause.over;
    }
  }
}

/**
 * Paths are built from ids, and ids often come from what users typed. A
 * `.` or `..` segment would be folded away by `fetch` and send the request,
 * with the bot's token, to another route than the one the code names.
 */
function assertPlainPath(path: string): void {
  const route = path.startsWith("/")
    ? path
    : path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  for (const segment of route.split(/[?#]/)[0].split(/[/\\]/)) {
    let plain = segment;
    try {
      plain = decodeURIComponent(segment);
    } catch {
      // not percent-encoded text: judge it as written
    }
    if (plain === "." || plain === "..") {
      throw new TypeError(
        "Zrzur: a request path must not contain '.' or '..' segments (is an id missing or wrong?)",
      );
    }
  }
}

/** Routes whose rate-limit bucket is remembered (the least recently used go first) */
const MAX_ROUTES = 1024;

/**
 * One key per route shape and resource. The server counts most limits per
 * resource, the first id of the path (each channel has its own messaging
 * bucket), so that id stays in the key: a full channel must not hold back
 * the others. Later ids (messages, members) don't make new entries.
 */
function routeKey(method: string, path: string): string {
  const shape = path
    .split("?")[0]
    .split("/")
    .map((part, index) =>
      index > 2 &&
      (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(part) || /^\d+$/.test(part))
        ? "{id}"
        : part,
    )
    .join("/");
  return `${method} ${shape}`;
}

/** Longest rate-limit wait the client accepts (ms) */
const MAX_WAIT = 30_000;

/** Milliseconds to wait, from the rate-limit headers */
function retryAfterOf(response: Response): number | undefined {
  return (
    Number(response.headers.get("x-ratelimit-reset-after")) ||
    Number(response.headers.get("retry-after")) * 1000 ||
    undefined
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
