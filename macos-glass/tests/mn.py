#!/usr/bin/env python3
"""Tiny Marionette client: drive a running Thunderbird (started with -marionette).

usage as module:
    from mn import MN
    m = MN(port)            # connects + new session + chrome context
    m.js("return document.title")
"""
import json, socket, time


class MN:
    def __init__(self, port=2828, timeout=60):
        t0 = time.time()
        while True:
            try:
                self.s = socket.create_connection(("127.0.0.1", port), timeout=5)
                self.buf = b""
                self._read()  # hello; fails/times out if the server isn't ready yet
                break
            except (OSError, ValueError):
                try:
                    self.s.close()
                except Exception:
                    pass
                if time.time() - t0 > timeout:
                    raise
                time.sleep(1)
        self.s.settimeout(45)
        self.mid = 0
        self.cmd("WebDriver:NewSession", {"capabilities": {}})
        self.cmd("Marionette:SetContext", {"value": "chrome"})

    def _read(self):
        while b":" not in self.buf:
            self.buf += self.s.recv(65536)
        n, rest = self.buf.split(b":", 1)
        n = int(n)
        while len(rest) < n:
            rest += self.s.recv(65536)
        msg, self.buf = rest[:n], rest[n:]
        return json.loads(msg)

    def cmd(self, name, params=None):
        self.mid += 1
        data = json.dumps([0, self.mid, name, params or {}]).encode()
        self.s.sendall(str(len(data)).encode() + b":" + data)
        while True:
            r = self._read()
            if r[1] == self.mid:
                if r[2]:
                    raise RuntimeError(json.dumps(r[2])[:2000])
                return r[3]

    def js(self, script, *args, sandbox=None):
        p = {"script": script, "args": list(args)}
        if sandbox:
            p["sandbox"] = sandbox
        r = self.cmd("WebDriver:ExecuteScript", p)
        return r.get("value") if isinstance(r, dict) else r

    def ajs(self, script, *args):
        r = self.cmd("WebDriver:ExecuteAsyncScript", {"script": script, "args": list(args)})
        return r.get("value") if isinstance(r, dict) else r

    def quit(self):
        try:
            self.cmd("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
