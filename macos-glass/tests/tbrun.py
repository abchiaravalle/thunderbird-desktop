#!/usr/bin/env python3
"""Launch a Thunderbird build on a fresh made-up profile with Marionette, run a probe.

usage: tbrun.py <App.app> [--port N] [--dark] [--keep] [--userchrome f.css] -- <python file run with m in scope>
The probe file gets: m (MN client), shot(path, extra_js=None), pid, prof, sleep.
"""
import os, sys, subprocess, tempfile, time, json, shutil, socket

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mn import MN


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def winid(pid):
    out = subprocess.run([os.path.join(HERE, "winid"), str(pid)], capture_output=True, text=True)
    return out.stdout.split()[0] if out.returncode == 0 else None


def main():
    argv = sys.argv[1:]
    probe = None
    if "--" in argv:
        i = argv.index("--"); probe = argv[i + 1]; argv = argv[:i]
    app = argv[0]
    dark = "--dark" in argv
    keep = "--keep" in argv
    uc = argv[argv.index("--userchrome") + 1] if "--userchrome" in argv else None
    port = free_port()
    prof = tempfile.mkdtemp(prefix="tbprof.")
    cmd = [sys.executable, os.path.join(HERE, "make_profile.py"), prof]
    if uc:
        cmd += ["--userchrome", uc]
    subprocess.run(cmd, check=True, capture_output=True)
    with open(os.path.join(prof, "user.js"), "a") as f:
        f.write(f'user_pref("marionette.port", {port});\n')
        f.write('user_pref("ui.systemUsesDarkTheme", %d);\n' % (1 if dark else 0))
        for k, v in json.loads(os.environ.get("EXTRA_PREFS", "{}")).items():
            vs = json.dumps(v)
            f.write(f'user_pref("{k}", {vs});\n')
    with open(os.path.join(prof, "xulstore.json"), "w") as f:
        json.dump({"chrome://messenger/content/messenger.xhtml": {"messengerWindow": {
            "screenX": "80", "screenY": "60", "width": os.environ.get("TB_W", "1360"),
            "height": os.environ.get("TB_H", "860"), "sizemode": "normal"}}}, f)
    binp = os.path.join(app, "Contents", "MacOS", "thunderbird")
    log = open("/tmp/tbrun.log", "w")
    env = dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS="1")
    p = subprocess.Popen([binp, "-profile", prof, "-no-remote", "-marionette"],
                         stdout=log, stderr=subprocess.STDOUT, env=env)
    m = None
    try:
        print('launched pid', p.pid, 'port', port, flush=True)
        m = MN(port, timeout=90)
        print('marionette session ok', flush=True)
        # wait for the main window
        if not os.environ.get("NO_WAIT"):
            for _ in range(60):
                try:
                    ok = m.js("const t=document.getElementById('tabmail'); return !!(t && t.currentAbout3Pane && t.currentAbout3Pane.document.readyState=='complete')")
                    if ok:
                        break
                except Exception as e:
                    print('wait err', repr(e)[:200], flush=True)
                time.sleep(0.5)

        def shot(path, settle=1.5):
            time.sleep(settle)
            w = winid(p.pid)
            if not w:
                print("no window"); return
            r = subprocess.run(["cua-driver", "call", "get_window_state", json.dumps(
                {"pid": p.pid, "window_id": int(w), "max_elements": 3, "screenshot_out_file": path})],
                capture_output=True, text=True)
            print("shot", path, "ok" if os.path.exists(path) else r.stdout[:300])

        g = {"m": m, "shot": shot, "pid": p.pid, "prof": prof, "sleep": time.sleep, "json": json}
        if probe:
            exec(open(probe).read(), g)
    finally:
        if m:
            m.quit()
        time.sleep(1.5)
        if p.poll() is None:
            p.kill()
        if not keep:
            shutil.rmtree(prof, ignore_errors=True)
        else:
            print("profile kept:", prof)


if __name__ == "__main__":
    main()
