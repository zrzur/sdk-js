"""Zrzur bot in Python over raw HTTP and WebSocket (standard library only).

This is a protocol example, not an official library. It registers
/hello [name] and answers it publicly, or privately with private:true.

    ZRZUR_API_URL=http://127.0.0.1:14702 ZRZUR_WS_URL=ws://127.0.0.1:14703 \
    ZRZUR_BOT_TOKEN=... python3 hello.py
"""

import base64
import json
import os
import socket
import ssl
import struct
import threading
import time
import urllib.request
from urllib.parse import urlparse

API = os.environ["ZRZUR_API_URL"].rstrip("/")
WS = os.environ["ZRZUR_WS_URL"].rstrip("/")
TOKEN = os.environ["ZRZUR_BOT_TOKEN"]  # never hard-code or print it


def api(method, path, body=None):
    request = urllib.request.Request(
        API + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"x-bot-token": TOKEN, "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        text = response.read().decode()
        return json.loads(text) if text else None


class WebSocket:
    """Just enough of RFC 6455 for text frames from a trusted server."""

    def __init__(self, url):
        parts = urlparse(url)
        port = parts.port or (443 if parts.scheme == "wss" else 80)
        sock = socket.create_connection((parts.hostname, port))
        if parts.scheme == "wss":
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=parts.hostname)
        key = base64.b64encode(os.urandom(16)).decode()
        path = (parts.path or "/") + ("?" + parts.query if parts.query else "")
        sock.sendall(
            (
                f"GET {path} HTTP/1.1\r\nHost: {parts.hostname}:{port}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        response = b""
        while b"\r\n\r\n" not in response:
            response += sock.recv(1)
        if b" 101 " not in response.split(b"\r\n")[0]:
            raise ConnectionError("WebSocket upgrade failed")
        self.sock = sock
        self.lock = threading.Lock()

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        header = bytes([0x81])
        if len(payload) < 126:
            header += bytes([0x80 | len(payload)])
        elif len(payload) < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", len(payload))
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", len(payload))
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        with self.lock:
            self.sock.sendall(header + mask + masked)

    def _read(self, n):
        data = b""
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                raise ConnectionError("closed")
            data += chunk
        return data

    def recv(self):
        message = b""
        while True:
            first, second = self._read(2)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read(8))[0]
            payload = self._read(length)
            opcode = first & 0x0F
            if opcode == 0x8:
                raise ConnectionError("closed")
            if opcode in (0x9, 0xA):  # ping / pong frames
                continue
            message += payload
            if first & 0x80:
                return message.decode()


def option(command, name):
    for item in command.get("options", []):
        if item["name"] == name:
            return item.get("value")
    return None


def on_interaction(interaction):
    command = interaction.get("command") or {}
    if interaction["type"] != "Command" or command.get("name") != "hello":
        return
    name = option(command, "name") or interaction["user"]["username"]
    api(
        "POST",
        f"/interactions/{interaction['_id']}/{interaction['token']}/callback",
        {
            "type": "Message",
            "data": {
                "content": f"أهلاً بك في زرزور يا {name}!",
                # only the user sees a private answer; it is never stored in the channel
                "ephemeral": option(command, "private") is True,
            },
        },
    )


def main():
    me = api("GET", "/users/@me")
    api(
        "PUT",
        f"/applications/{me['_id']}/commands",
        [
            {
                "name": "hello",
                "description": "Say hello",
                "description_localizations": {"ar": "قل مرحباً"},
                "options": [
                    {"type": "String", "name": "name", "description": "Who to greet"},
                    {"type": "Boolean", "name": "private", "description": "Only you see the answer"},
                ],
            }
        ],
    )

    while True:
        try:
            ws = WebSocket(WS + "/?version=1&format=json")
            # authenticate with a message so the token is not in the URL
            ws.send(json.dumps({"type": "Authenticate", "token": TOKEN}))

            def heartbeat():
                while True:
                    time.sleep(20)
                    ws.send(json.dumps({"type": "Ping", "data": int(time.time() * 1000)}))

            threading.Thread(target=heartbeat, daemon=True).start()
            while True:
                packet = json.loads(ws.recv())
                if packet["type"] == "Ready":
                    print(f"ready as {me['username']}", flush=True)
                elif packet["type"] == "InteractionCreate":
                    # answer within 3 seconds; run slow work after deferring
                    threading.Thread(
                        target=on_interaction, args=(packet["interaction"],), daemon=True
                    ).start()
        except (ConnectionError, OSError) as error:
            print(f"disconnected ({error}), retrying in 3 s", flush=True)
            time.sleep(3)


if __name__ == "__main__":
    main()
