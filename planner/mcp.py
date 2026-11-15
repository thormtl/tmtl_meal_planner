"""Minimal stdio MCP client for handle-mcp (BilkaToGo). Standard library only.

The server runs on this Mac with the store login from the macOS keychain; nothing secret passes
through this code or the repo. Telemetry is always off (HANDLE_TELEMETRY=0).
"""
from __future__ import annotations

import json
import os
import subprocess
from typing import Any

HANDLE = os.environ.get("TMTL_HANDLE_MCP", "handle-mcp@1.8.0")  # pinned: reviewed version only


class StoreError(RuntimeError):
    pass


class Handle:
    def __init__(self) -> None:
        env = {**os.environ, "HANDLE_TELEMETRY": "0"}
        self._p = subprocess.Popen(["uvx", HANDLE], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, text=True, env=env)
        self._id = 0
        self._rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                 "clientInfo": {"name": "tmtl_meal_planner", "version": "0.1"}})
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _send(self, msg: dict) -> None:
        assert self._p.stdin
        self._p.stdin.write(json.dumps(msg) + "\n")
        self._p.stdin.flush()

    def _rpc(self, method: str, params: dict) -> dict:
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        assert self._p.stdout
        while True:
            line = self._p.stdout.readline()
            if not line:
                raise StoreError("handle-mcp stopped")
            msg = json.loads(line)
            if msg.get("id") == self._id:
                if "error" in msg:
                    raise StoreError(msg["error"].get("message", "MCP error"))
                return msg["result"]

    def call(self, tool: str, **args: Any) -> Any:
        res = self._rpc("tools/call", {"name": tool, "arguments": args})
        text = res["content"][0]["text"] if res.get("content") else ""
        if res.get("isError"):
            raise StoreError(text[:300])
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return text
        if isinstance(data, dict) and "bilkatogo" in data and len(data) == 1:
            data = data["bilkatogo"]
        if isinstance(data, dict) and set(data) == {"error"}:
            raise StoreError(str(data["error"])[:300])
        return data

    def close(self) -> None:
        self._p.kill()

    def __enter__(self) -> "Handle":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
