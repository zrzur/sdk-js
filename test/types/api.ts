import { API } from "../../src/core/API.js";
import type { User, Message } from "../../src/api/types.js";

declare const api: API;
declare const id: string;

// responses are typed from the route
export const u: Promise<User> = api.get(`/users/${id}`);
export const me: Promise<User> = api.get("/users/@me");
export const m: Promise<Message> = api.post(`/channels/${id}/messages`, { content: "hi" });

// @ts-expect-error unknown route
api.get("/no/such/route");
// @ts-expect-error wrong body field type
api.post(`/channels/${id}/messages`, { content: 5 });
// @ts-expect-error body required
api.put(`/channels/${id}/permissions/${id}`);
// @ts-expect-error wrong response type
export const bad: Promise<Message> = api.get(`/users/${id}`);

// the most specific template wins: /servers/x/ack takes no body
api.put(`/servers/${id}/ack`);
// list bodies (replace every command)
api.put(`/applications/${id}/commands`, [{ name: "hello", description: "Say hello" }]);
