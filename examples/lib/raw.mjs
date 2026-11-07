// Tiny raw HTTP + WebSocket helper shared by the protocol-level examples.
// Real bots should use the Zrzur Bot SDK; these examples show the wire protocol.

export function connectBot({ onInteraction, onReady, onEvent } = {}) {
  const API = process.env.ZRZUR_API_URL;
  const WS = process.env.ZRZUR_WS_URL;
  const TOKEN = process.env.ZRZUR_BOT_TOKEN;
  if (!API || !WS || !TOKEN) {
    console.error("Set ZRZUR_API_URL, ZRZUR_WS_URL and ZRZUR_BOT_TOKEN");
    process.exit(1);
  }

  async function api(method, path, body) {
    const response = await fetch(API + path, {
      method,
      headers: { "x-bot-token": TOKEN, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const error = new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? undefined : response.json();
  }

  function respond(interaction, body) {
    return api("POST", `/interactions/${interaction._id}/${interaction.token}/callback`, body);
  }

  function editOriginal(interaction, data) {
    return api("PATCH", `/interactions/${interaction._id}/${interaction.token}/original`, data);
  }

  function connect() {
    const socket = new WebSocket(`${WS}?version=1&format=json`);
    let heartbeat;
    socket.addEventListener("open", () => {
      // Authenticate with a message so the token never appears in a URL
      socket.send(JSON.stringify({ type: "Authenticate", token: TOKEN }));
    });
    socket.addEventListener("message", (event) => {
      const packet = JSON.parse(event.data);
      if (packet.type === "Ready") {
        heartbeat = setInterval(
          () => socket.send(JSON.stringify({ type: "Ping", data: Date.now() })),
          20_000,
        );
        onReady?.(packet);
      } else if (packet.type === "InteractionCreate") {
        Promise.resolve(onInteraction?.(packet.interaction)).catch((error) =>
          console.error("interaction failed:", error.message),
        );
      } else if (packet.type === "Error") {
        console.error("gateway error:", packet.error);
      }
      onEvent?.(packet);
    });
    socket.addEventListener("close", () => {
      clearInterval(heartbeat);
      setTimeout(connect, 3_000);
    });
  }

  connect();
  return { api, respond, editOriginal };
}

/** Value of an option by name, looking inside sub-commands */
export function optionValue(options = [], name) {
  for (const option of options) {
    if (option.name === name) return option.value;
    if (option.options) {
      const nested = optionValue(option.options, name);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

export const Permissions = {
  ManageChannel: 1 << 0,
  ManagePermissions: 1 << 2,
  ManageRole: 1 << 3,
  AssignRoles: 1 << 9,
  ViewChannel: 1 << 20,
  ReadMessageHistory: 1 << 21,
  SendMessage: 1 << 22,
};
