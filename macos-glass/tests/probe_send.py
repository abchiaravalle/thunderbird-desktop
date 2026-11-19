"""Send path test: compose an HTML message, "send later" to the local Outbox
(no network, no real recipient), then read the stored copy and check the
pixel <img> and the X-Superhuman-Receipt header match. Then load the pixel
URL from the real service and confirm the open is counted."""
import os, sys, json, re, urllib.request, time
m.s.settimeout(90)
sleep(2)
m.js("""
const {MailServices} = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
const params = Cc['@mozilla.org/messengercompose/composeparams;1'].createInstance(Ci.nsIMsgComposeParams);
const fields = Cc['@mozilla.org/messengercompose/composefields;1'].createInstance(Ci.nsIMsgCompFields);
fields.to = 'Lorem Ipsum <adam@amplifi.studio>';
fields.subject = 'Receipt pixel test';
fields.body = '<p>Testing the read receipt.</p>';
params.composeFields = fields;
params.format = Ci.nsIMsgCompFormat.HTML;
params.identity = MailServices.accounts.allIdentities[0];
MailServices.compose.OpenComposeWindowWithParams(null, params);
""")
sleep(5)
r = m.ajs("""
const done = arguments[arguments.length - 1];
const w = [...Services.wm.getEnumerator('msgcompose')].pop();
if (!w) return done({err: 'no compose window'});
w.addEventListener('compose-send-message', () => {}, true);
w.Services.prefs.setBoolPref('mailnews.sendInBackground', false);
w.goDoCommand('cmd_sendLater');
setTimeout(() => done({ok: true}), 6000);
""")
print("send later:", r, flush=True)
sleep(2)
out = m.js("""
const {MailServices} = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
const root = MailServices.accounts.localFoldersServer.rootFolder;
const outbox = root.getFolderWithFlags(Ci.nsMsgFolderFlags.Queue);
if (!outbox) return {err: 'no outbox'};
const hdrs = [...outbox.messages];
const h = hdrs.find(x => x.mime2DecodedSubject == 'Receipt pixel test');
if (!h) return {err: 'not in outbox', n: hdrs.length};
return {rid: h.getStringProperty('x-superhuman-receipt'), path: outbox.filePath.path, key: h.messageKey};
""")
print("outbox:", out, flush=True)
raw = open(out["path"], "rb").read().decode("utf-8", "ignore") if out and out.get("path") else ""
seg = raw[raw.rfind("Subject: Receipt pixel test") - 2000:] if "Receipt pixel test" in raw else ""
hdr = re.search(r"^X-Superhuman-Receipt:\s*([a-f0-9]{32})", seg, re.M)
img = re.search(r'https://r\.amplifi\.studio/p/([a-f0-9]{32})\.gif', seg.replace("=\r\n", "").replace("=\n", "").replace("=3D", "="))
print("header id:", hdr.group(1) if hdr else None, "| pixel id:", img.group(1) if img else None, "| db id:", out.get("rid"), flush=True)
ok = bool(hdr and img and hdr.group(1) == img.group(1) == out.get("rid"))
print("PIXEL_MATCH", ok, flush=True)
open("/tmp/tb_sent_raw.eml","w").write(seg)
if ok:
    rid = img.group(1)
    urllib.request.urlopen(urllib.request.Request(f"https://r.amplifi.studio/p/{rid}.gif", headers={"User-Agent": "Mozilla/5.0 (iPhone)"}), timeout=20).read()
    time.sleep(2)
    tok = open(os.path.expanduser("~/.hermes/secrets/tb-receipts/token")).read().strip()
    d = json.load(urllib.request.urlopen(urllib.request.Request(f"https://r.amplifi.studio/api/opens?ids={rid}", headers={"Authorization": "Bearer " + tok, "User-Agent": "t"}), timeout=20))
    print("SERVICE_COUNTED", len(d.get(rid, [])) == 1, d.get(rid), flush=True)
    open("/tmp/tb_sent_rid.txt", "w").write(rid)
