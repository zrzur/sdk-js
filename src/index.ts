// @zrzur/sdk: the official Zrzur library for apps and bots.
// This entry point has no UI framework: HTTP API, gateway, types and events.
// Bots: @zrzur/sdk/bot. SolidJS apps: @zrzur/sdk/solid.
export * as API from "./core/namespace.js";
export {
  API as Api,
  type APIOptions,
  type APIRoutes,
  type RequestOptions,
  getPathName,
} from "./core/API.js";
export { ApiError, redact } from "./core/errors.js";
export {
  CLOSE_DISALLOWED_INTENTS,
  Intents,
  ConnectionState,
  Gateway,
  type GatewayEvents,
  type GatewayOptions,
  backoff,
  intentBits,
} from "./core/Gateway.js";
export type * from "./core/protocol.js";
export * from "./core/permissions.js";
export * from "./core/regex.js";
