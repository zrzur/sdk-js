import { createSignal } from "solid-js";

/**
 * "View server as role": the app shows one server as members with the
 * chosen roles see it, as in Discord. Only what this app shows changes (the
 * channels, the composer, the menus); the API still uses your own rights.
 *
 * An empty role list is @everyone: a member with no role at all.
 */
export interface ViewAs {
  serverId: string;
  roleIds: string[];
}

const [current, setCurrent] = createSignal<ViewAs | undefined>();

/**
 * The view in use, or undefined. With a server id: only when that server is
 * the one being viewed as roles.
 */
export function viewingAs(serverId?: string): ViewAs | undefined {
  const view = current();
  if (!view) return undefined;
  if (serverId && view.serverId !== serverId) return undefined;
  return view;
}

/** Show a server as members with these roles see it */
export function viewServerAs(serverId: string, roleIds: string[]): void {
  setCurrent({ serverId, roleIds: [...new Set(roleIds)] });
}

/** Go back to your own view */
export function stopViewingAs(): void {
  setCurrent(undefined);
}
