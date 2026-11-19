#!/usr/bin/env python3
"""Deploy the read-receipt Worker to r.amplifi.studio. Idempotent; never prints secrets.

D1 database -> schema -> wrangler.toml -> deploy -> TOKEN secret (made once) -> health checks.
Local copy of the read token: ~/.hermes/secrets/tb-receipts/token (0600).
"""
import json, os, re, secrets, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WR = "/Users/adamchiaravalle/gits/analoglaura-swatches/node_modules/.bin/wrangler"
HOST = "r.amplifi.studio"
NAME = "tb-receipts"
SECRETS_DIR = os.path.expanduser("~/.hermes/secrets/tb-receipts")
TOKEN_FILE = os.path.join(SECRETS_DIR, "token")
API = "https://api.cloudflare.com/client/v4"

ENV = {}
for line in open(os.path.expanduser("~/.hermes/secrets/cloudflare.env")):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        ENV[k.replace("export ", "").strip()] = v.strip().strip('"').strip("'")
T, A = ENV["CLOUDFLARE_API_TOKEN"], ENV["CLOUDFLARE_ACCOUNT_ID"]
wenv = dict(os.environ, CLOUDFLARE_API_TOKEN=T, CLOUDFLARE_ACCOUNT_ID=A)


def cf(path, payload=None, method=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(API + path, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"Authorization": f"Bearer {T}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        b = e.read().decode()
        try:
            return json.loads(b)
        except Exception:
            return {"success": False, "errors": [{"code": e.code, "message": b[:300]}]}


def wr(*args, input_text=None):
    p = subprocess.run([WR, *args], cwd=HERE, env=wenv, capture_output=True, text=True, input=input_text)
    return p.returncode, p.stdout + p.stderr


os.makedirs(SECRETS_DIR, mode=0o700, exist_ok=True)

# 1) D1 database
dbs = cf(f"/accounts/{A}/d1/database?name={NAME}").get("result") or []
db = next((d for d in dbs if d["name"] == NAME), None)
if not db:
    r = cf(f"/accounts/{A}/d1/database", {"name": NAME})
    if not r.get("success"):
        sys.exit(f"FAIL create D1: {r.get('errors')}")
    db = r["result"]
db_id = db.get("uuid") or db.get("id")
print("d1", NAME, db_id[:8])

# 2) schema
r = cf(f"/accounts/{A}/d1/database/{db_id}/query", {"sql": open(os.path.join(HERE, "schema.sql")).read()})
print("schema", r.get("success"), [e.get("message") for e in r.get("errors") or []])
if not r.get("success"):
    sys.exit(1)

# 3) config
open(os.path.join(HERE, "wrangler.toml"), "w").write(f'''name = "{NAME}"
main = "src/index.js"
compatibility_date = "2026-10-01"
account_id = "{A}"
workers_dev = false
preview_urls = false
routes = [ {{ pattern = "{HOST}", custom_domain = true }} ]

[[d1_databases]]
binding = "DB"
database_name = "{NAME}"
database_id = "{db_id}"

[triggers]
crons = ["23 6 * * *"]
''')

# 4) deploy
code, out = wr("deploy")
print("deploy exit", code)
print("\n".join(l for l in out.splitlines() if re.search(r"Uploaded|Deployed|custom domain|error|Error|r\.amplifi", l))[:1500])
if code != 0:
    sys.exit(1)

# 5) read token (made once)
if not os.path.exists(TOKEN_FILE):
    tok = secrets.token_urlsafe(32)
    with open(TOKEN_FILE, "w") as f:
        f.write(tok)
    os.chmod(TOKEN_FILE, 0o600)
tok = open(TOKEN_FILE).read().strip()
code, out = wr("secret", "put", "TOKEN", input_text=tok)
print("secret TOKEN exit", code, "len", len(tok))

# 6) health
time.sleep(4)
def get(path, headers=None):
    req = urllib.request.Request(f"https://{HOST}{path}", headers=dict({"User-Agent": "tb-receipts-deploy"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers.get("content-type"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type"), e.read()

for i in range(20):
    s, ct, b = get("/p/" + "0" * 32 + ".gif")
    if s == 200:
        break
    time.sleep(6)
print("pixel", s, ct, len(b))
print("root", get("/")[0], "api-no-auth", get("/api/opens?ids=" + "0" * 32)[0])
s, ct, b = get("/api/opens?ids=" + "0" * 32, {"Authorization": "Bearer " + tok})
print("api-auth", s, b[:120])
