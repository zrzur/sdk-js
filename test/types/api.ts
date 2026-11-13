import type { Message, User } from "../../src/api/types.js";
// bot managers: no method may lose its response type (`never` assigns to
// anything, so each is checked against a type it must not be)
import type { Member } from "../../src/api/types.js";
import type { MemberManager, MessageManager } from "../../src/bot/managers.js";
import { API } from "../../src/core/API.js";

declare const api: API;
declare const id: string;

// responses are typed from the route
export const u: Promise<User> = api.get(`/users/${id}`);
export const me: Promise<User> = api.get("/users/@me");
export const m: Promise<Message> = api.post(`/channels/${id}/messages`, {
  content: "hi",
});

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
api.put(`/applications/${id}/commands`, [
  { name: "hello", description: "Say hello" },
]);

type IsNever<T> = [T] extends [never] ? true : false;
declare const messages: MessageManager;
declare const members: MemberManager;
export const manyTyped: IsNever<
  Awaited<ReturnType<MessageManager["fetchMany"]>>
> = false;
export const allTyped: IsNever<Awaited<ReturnType<MemberManager["fetchAll"]>>> =
  false;
export const many: Promise<Message[]> = messages.fetchMany(id, { limit: 5 });
export const all: Promise<{ members: Member[]; users: User[] }> =
  members.fetchAll(id);
