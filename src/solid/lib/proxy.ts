/**
 * Address to load an outside image (embed icons, masquerade avatars)
 * from. Outside images only ever load through the media proxy: loading
 * them directly would show whoever sent them the address of every viewer.
 * Without a proxy they are not loaded at all. Files on the server's own
 * media host load as they are.
 *
 * @param url Address the message gave
 * @param proxy Media proxy base, when the server runs one
 * @param ownMedia The server's own file host (Autumn), if known
 * @param ticket Media proxy ticket, when one is held
 */
export function proxiedImageURL(
  url: string,
  proxy: string | undefined,
  ownMedia?: string,
  ticket?: string,
): string | undefined {
  // web addresses only: no javascript:, data:, file: or relative paths
  if (!/^https?:\/\/[^/\s]/i.test(url) || /[\s\p{Cc}]/u.test(url)) {
    return undefined;
  }
  if (ownMedia && sameOrigin(url, ownMedia)) return url;
  if (!proxy) return undefined;
  const address = `${proxy.replace(/\/+$/, "")}/proxy?url=${encodeURIComponent(url)}`;
  return ticket ? `${address}&t=${encodeURIComponent(ticket)}` : address;
}

function sameOrigin(url: string, base: string) {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
