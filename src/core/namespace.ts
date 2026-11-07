// Everything about the HTTP API in one namespace: `API.API` is the client,
// `API.User`, `API.Message`, … are the server's types.
export * from "../api/types.js";
export {
  API,
  type APIOptions,
  type APIRoutes,
  type RequestOptions,
  type RouteOf,
  getPathName,
} from "./API.js";
