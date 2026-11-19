"""Every-key test. Sends REAL native key events (nsITextInputProcessor) into the
about:3pane window and checks each key's actual effect on app state.

Run with SENT_RECEIPTS set (3 receipt ids with known opens on the live service)
and EXTRA_PREFS carrying the receipts token.
"""
import os, sys, json
sys.path.insert(0, os.path.expanduser("~/src/tb-glass/tools"))
from tbhelpers import open_inbox
m.s.settimeout(60)
OUT = os.environ.get("SHOT_PREFIX", "/tmp/tbkeys")
open_inbox(m, sleep)
sleep(2)
A3 = "const a=document.getElementById('tabmail').currentAbout3Pane; const s=a.superhuman;"
KEY = A3 + """
const [key, mods] = arguments;
const tip = Cc['@mozilla.org/text-input-processor;1'].createInstance(Ci.nsITextInputProcessor);
tip.beginInputTransactionForTests(window);
const codeFor = k => k.length == 1 ? (/[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : (/[0-9]/.test(k) ? 'Digit' + k : '')) : k;
const MOD = {metaKey:'Meta', ctrlKey:'Control', shiftKey:'Shift', altKey:'Alt'};
for (const k in MOD) if (mods && mods[k]) tip.keydown(new KeyboardEvent('keydown', {key: MOD[k]}));
const ev = new KeyboardEvent('keydown', {key, code: codeFor(key)});
tip.keydown(ev); tip.keyup(ev);
for (const k in MOD) if (mods && mods[k]) tip.keyup(new KeyboardEvent('keyup', {key: MOD[k]}));
return true;
"""
STATE = A3 + """
const v = a.gDBView; const n = v ? v.numSelected : 0;
const h = n ? v.hdrForFirstSelectedMessage : null;
return {sel: a.threadTree.selectedIndex, cur: a.threadTree.currentIndex, numSel: n, rows: v ? v.rowCount : -1,
  subj: h ? h.mime2DecodedSubject : null, flagged: h ? h.isFlagged : null, read: h ? h.isRead : null,
  tags: h ? h.getStringProperty('keywords').trim() : null, killed: h ? !!(a.gDBView.getThreadContainingMsgHdr(h).flags & Ci.nsMsgMessageFlags.Ignored) : null,
  reading: s.reading, palette: s.paletteOpen, paletteQ: s._paletteInput.value, split: s.activeSplit,
  folder: a.gFolder ? a.gFolder.URI.split('/').pop() : null, folders: !a.paneLayout.folderPaneSplitter.isCollapsed,
  toast: s.lastToast || null, zoom: Math.round((top.ZoomManager ? top.ZoomManager.getZoomForBrowser(a.messageBrowser) : 1) * 100) / 100,
  qf: JSON.stringify(a.quickFilterBar.filterer.filterValues), focus: (document.activeElement||{}).localName,
  composeWins: [...Services.wm.getEnumerator('msgcompose')].length,
  wins3: [...Services.wm.getEnumerator('mail:3pane')].length,
  showIgnored: a.gViewWrapper && a.gViewWrapper.showIgnored,
  open: (v && a.threadTree.currentIndex >= 0 && a.threadTree.currentIndex < v.rowCount && v.isContainer(a.threadTree.currentIndex)) ? v.isContainerOpen(a.threadTree.currentIndex) : null,
  copied: s._lastCopied || null}
"""
results = []
LOOKUP = """
const [mid] = arguments;
const {MailServices} = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
const found = [];
for (const f of MailServices.accounts.localFoldersServer.rootFolder.descendants) {
  let h = null; try { h = f.msgDatabase.getMsgHdrForMessageID(mid); } catch (e) {}
  if (!h) continue;
  const th = f.msgDatabase.getThreadContainingMsgHdr(h);
  found.push({folder: decodeURIComponent(f.URI.split('Local%20Folders/')[1] || f.URI), tags: h.getStringProperty('keywords').trim(),
              junk: h.getStringProperty('junkscore'), killed: !!(th && (th.flags & Ci.nsMsgMessageFlags.Ignored))});
}
if (!found.length) return null;
const r = found.length == 1 ? found[0] : (found.find(x => x.folder != 'Inbox') || found[0]);
r.where = found.map(x => x.folder); return r;"""
def look(mid):
    return m.js(LOOKUP, mid)
def cur_mid():
    return m.js(A3 + "const v=a.gDBView; return v && v.numSelected ? v.hdrForFirstSelectedMessage.messageId : null")
m.js(A3 + """
if (!a.commandController.__spied) { const orig = a.commandController.doCommand.bind(a.commandController);
  a.commandController.doCommand = function (c, ...rest) { (s._cmds = s._cmds || []).push(c); return orig(c, ...rest); };
  a.commandController.__spied = true; }""")
def cmds():
    return m.js(A3 + "const c = s._cmds || []; s._cmds = []; return c;")
def compose_subject():
    return m.js("const w=[...Services.wm.getEnumerator('msgcompose')].pop(); return w ? w.document.getElementById('msgSubject').value : null")

def key(k, **mods):
    m.js("window.focus();" + A3 + "a.focus();")
    m.js(KEY, k, mods)
    sleep(0.6)

def st():
    return m.js(STATE)

def check(name, ok, info=None):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name, "" if ok else json.dumps(info)[:400], flush=True)

def reset(split="important", index=0):
    m.js(A3 + """
    for (const w of [...Services.wm.getEnumerator('msgcompose')]) w.close();
    if (s.paletteOpen) s.closePalette(); if (s.reading) s.closeReading();
    a.quickFilterBar.filterer.clear(); a.quickFilterBar.updateSearch();
    if (!a.gFolder.getFlag(Ci.nsMsgFolderFlags.Inbox)) s.go('Inbox');
    s.selectSplit(arguments[0]); a.threadTree.selectedIndex = arguments[1]; a.threadTree.table.body.focus();
    s._noReply = false; s._picking = false;""", split, index)
    sleep(0.8)

def close_compose():
    m.js("for (const w of [...Services.wm.getEnumerator('msgcompose')]) w.close();")
    sleep(0.5)

# ---------------------------------------------------------------- navigation
reset()
key("j"); check("J next conversation", st()["sel"] == 1, st())
key("k"); check("K previous conversation", st()["sel"] == 0, st())
key("ArrowDown"); check("Down arrow next", st()["sel"] == 1, st())
key("ArrowUp"); check("Up arrow previous", st()["sel"] == 0, st())
key("ArrowDown", metaKey=True); s1 = st(); check("Cmd+Down jump to bottom", s1["sel"] == s1["rows"] - 1, s1)
key("ArrowUp", metaKey=True); check("Cmd+Up jump to top", st()["sel"] == 0, st())
key(" "); check("Space scrolls list down", st()["sel"] > 0, st())
key(" ", shiftKey=True); check("Shift+Space scrolls back up", st()["sel"] == 0, st())
key("Enter"); check("Enter opens conversation", st()["reading"] is True, st())
key("n"); s2 = st(); check("N next message (in conversation)", s2["sel"] == 1, s2)
key("p"); check("P previous message", st()["sel"] == 0, st())
m.js(A3 + "s._bodyDocument().body.insertAdjacentHTML('beforeend', '<p><a href=\"https://example.com/a\">a</a> <a href=\"https://example.com/b\">b</a></p>')")
key("Tab"); f1 = m.js(A3 + "return s._bodyDocument().activeElement.href || null")
key("Tab"); f2 = m.js(A3 + "return s._bodyDocument().activeElement.href || null")
check("Tab cycles links in a message", f1 == "https://example.com/a" and f2 == "https://example.com/b", [f1, f2])
key("Escape"); check("Esc back to list", st()["reading"] is False, st())
key("Tab"); check("Tab next split", st()["split"] == "team", st())
key("Tab", shiftKey=True); check("Shift+Tab previous split", st()["split"] == "important", st())
key("ArrowLeft"); f_on = st()["folders"]; key("ArrowLeft"); check("Left arrow toggles folders", f_on is True and st()["folders"] is False, st())

# ---------------------------------------------------------------- selection
reset()
key("x"); key("j"); key("x"); check("X selects (two picked)", st()["numSel"] == 2, st())
key("Escape"); check("Esc clears selection", st()["numSel"] == 1, st())
reset()
key("J", shiftKey=True); key("J", shiftKey=True); check("Shift+J extends selection down", st()["numSel"] == 3, st())
key("K", shiftKey=True); check("Shift+K extends (moves) selection up", st()["numSel"] >= 2, st())
reset(index=1)
key("a", metaKey=True); s3 = st(); check("Cmd+A selects from here down", s3["numSel"] == s3["rows"] - 1, s3)
key("A", metaKey=True, shiftKey=True); s3 = st(); check("Cmd+Shift+A selects all", s3["numSel"] == s3["rows"], s3)

# ---------------------------------------------------------------- triage
reset()
key("s"); f = st()["flagged"]; key("s"); check("S star / unstar", f is True and st()["flagged"] is False, st())
r1 = st()["read"]; key("u"); r2 = st()["read"]; check("U read / unread", r1 != r2, [r1, r2]); key("u")
key("h"); s4 = st(); check("H remind (stars + toast)", s4["flagged"] is True and "follow up" in (s4["toast"] or ""), s4); key("s")
before = st()["rows"]; key("e"); sleep(0.8); check("E done (archived)", st()["rows"] == before - 1, st())
key("z"); sleep(1.2); check("Z undo", st()["rows"] == before, st())
before = st()["rows"]; key("#", shiftKey=True); sleep(0.8); check("# trash", st()["rows"] == before - 1, st())
key("z"); sleep(1.2); check("Z undo trash", st()["rows"] == before, st())
mid = cur_mid(); key("!", shiftKey=True); sleep(1.2); info = look(mid); check("! spam (junk flag set)", info and info["junk"] == "100", info)
m.js("const {MailServices} = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');")
reset()
reset("team"); mid = cur_mid(); key("M", shiftKey=True); sleep(1.0); info = look(mid); check("Shift+M mute (thread ignored)", info and info["killed"] is True, info)
reset("todo"); mid = cur_mid(); key("e"); sleep(1.2)
m.js(A3 + "s.go('Archive')"); sleep(1.5)
m.js(A3 + "for (let i=0;i<a.gDBView.rowCount;i++) if (a.gDBView.getMsgHdrAt(i).messageId==arguments[0]) { a.threadTree.selectedIndex=i; break; } a.threadTree.table.body.focus();", mid); sleep(0.5)
a_before = look(mid)
key("E", shiftKey=True); sleep(1.2); a_after = look(mid)
check("Shift+E not done (Archive -> Inbox)", a_before and a_before["folder"] != "Inbox" and a_after and a_after["folder"] == "Inbox", [a_before, a_after])

# ---------------------------------------------------------------- labels / move
reset()
key("l"); s8 = st(); check("L opens label picker", s8["palette"] and s8["paletteQ"].startswith("label:"), s8)
key("Escape")
RETAG = """const [mid, key] = arguments;
const {MailServices} = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
const f = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed('Inbox');
const h = f.msgDatabase.getMsgHdrForMessageID(mid); f.addKeywordsToMessages([h], key);"""
reset("team", 0); mid = cur_mid(); key("y"); sleep(0.8); info = look(mid)
check("Y removes this split's label", info and "$label2" not in info["tags"], info); m.js(RETAG, mid, "$label2")
reset("team", 0); mid = cur_mid(); key("Y", shiftKey=True); sleep(0.8); info = look(mid)
check("Shift+Y removes all labels", info and info["tags"] == "", info); m.js(RETAG, mid, "$label2")
reset("team", 0); mid = cur_mid(); key("["); sleep(0.8); info = look(mid); s15 = st()
check("[ remove label, next", info and "$label2" not in info["tags"] and s15["sel"] == 0 and s15["subj"], [info, s15]); m.js(RETAG, mid, "$label2")
reset("team", 2); mid = cur_mid(); key("]"); sleep(0.8); info = look(mid); s15 = st()
check("] remove label, previous", info and "$label2" not in info["tags"] and s15["sel"] == 1, [info, s15]); m.js(RETAG, mid, "$label2")
reset()
key("v"); s10 = st(); check("V opens move picker", s10["palette"] and s10["paletteQ"].startswith("move:"), s10)
key("Escape")

# ---------------------------------------------------------------- compose
for k, label, want_cmd, prefix in [("c", "C compose", "cmd_newMessage", ""), ("r", "R reply", "cmd_replySender", "Re:"), ("f", "F forward", "cmd_forwardInline", "Fwd:")]:
    reset(); cmds(); key(k); sleep(3); subj_c = compose_subject(); c = cmds()
    check(label, want_cmd in c and subj_c is not None and subj_c.startswith(prefix), [c, subj_c]); close_compose()
reset(); key("Enter"); cmds(); key("Enter"); sleep(3); c = cmds(); subj_c = compose_subject()
check("Enter in a message = reply all", "cmd_replyall" in c and (subj_c or "").startswith("Re:"), [c, subj_c]); close_compose()

# ---------------------------------------------------------------- go-to
m.js("""const {MailServices} = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
const root = MailServices.accounts.localFoldersServer.rootFolder;
if (!root.containsChildNamed('Templates')) root.createSubfolder('Templates', null);
root.getChildNamed('Templates').setFlag(Ci.nsMsgFolderFlags.Templates);""")
sleep(1)
reset()
for seq, want, label in [("i", "Inbox", "G I Important"), ("o", "Inbox", "G O Other"), ("s", "Inbox", "G S Starred"),
                         ("d", "Drafts", "G D Drafts"), ("t", "Sent", "G T Sent"), ("e", "Archives", "G E Done"),
                         ("h", "Inbox", "G H Reminders"), ("m", "Inbox", "G M Muted"), (";", "Templates", "G ; Snippets"),
                         ("!", "Junk", "G ! Spam"), ("#", "Trash", "G # Trash"), ("a", "Inbox", "G A All Mail")]:
    reset(); key("g")
    if seq in "!#": key(seq, shiftKey=True)
    else: key(seq)
    sleep(0.8); s11 = st()
    ok = (s11["folder"] == want) if want else ("Templates" in (s11["toast"] or "") or s11["folder"] == "Templates")
    if seq == "o": ok = ok and s11["split"] == "other"
    if seq == "i": ok = ok and s11["split"] == "important"
    if seq == "a": ok = ok and s11["split"] is None
    if seq in "sh": ok = ok and '"starred":true' in s11["qf"]
    if seq == "m": ok = ok and s11["showIgnored"] is True
    check(label, ok, s11)
reset(); key("g"); key("l"); s12 = st(); check("G L go to label", s12["palette"] and s12["paletteQ"].startswith("golabel:"), s12); key("Escape")

# ---------------------------------------------------------------- filters
reset(); key("U", shiftKey=True); check("Shift+U unread only", '"unread":true' in st()["qf"], st())
reset(); key("S", shiftKey=True); check("Shift+S starred only", '"starred":true' in st()["qf"], st())
reset("team"); key("I", shiftKey=True); check("Shift+I important only", st()["split"] == "important", st())
reset(); key("R", shiftKey=True); check("Shift+R waiting on a reply", '"superhumanNoReply":true' in st()["qf"], st())

# ---------------------------------------------------------------- app keys
reset()
key("k", metaKey=True); check("Cmd+K palette", st()["palette"] is True, st()); key("Escape")
check("Esc closes palette", st()["palette"] is False, st())
key("?", shiftKey=True); check("? shortcuts list", st()["palette"] is True, st()); key("Escape")
key("/"); foc = m.js("const e = document.activeElement; return e ? (e.closest && e.closest('global-search-bar') ? 'global-search-bar' : e.localName) : null")
check("/ search (focuses search box)", foc == "global-search-bar", foc)
m.js(A3 + "a.threadTree.table.body.focus()")
z0 = m.js("return top.ZoomManager ? top.ZoomManager.zoom : null")
key("=", metaKey=True); z1 = m.js("return top.ZoomManager ? top.ZoomManager.zoom : null")
key("-", metaKey=True); key("-", metaKey=True); z2 = m.js("return top.ZoomManager ? top.ZoomManager.zoom : null")
key("0", metaKey=True); z3 = m.js("return top.ZoomManager ? top.ZoomManager.zoom : null")
check("Cmd+= / Cmd+- / Cmd+0 text size", z1 is not None and z1 > z0 and z2 < z1 and z3 == z0, [z0, z1, z2, z3])
reset(); key("/", ctrlKey=True); check("Ctrl+/ copy link", (st()["copied"] or "").startswith("mid:"), st())
reset(); m.js(A3 + "s.go('SentMail')"); sleep(1); key("1", ctrlKey=True); sleep(0.8); s16 = st()
check("Ctrl+1 switch account (to its Inbox)", s16["folder"] == "Inbox", s16)
reset(); key("o"); s13 = st(); check("O expand / collapse", "nothing to expand" in (s13["toast"] or "") or s13["open"] is not None, s13)
reset(); cmds(); key("O", shiftKey=True); c = cmds(); check("Shift+O expand all", "cmd_expandAllThreads" in c, c)
reset(); key("n", metaKey=True); sleep(3); w = st()["wins3"]; check("Cmd+N new window", w >= 2, st())
m.js("const ws=[...Services.wm.getEnumerator('mail:3pane')]; for (const w of ws.slice(1)) w.close();"); sleep(1)
reset(); key(",", metaKey=True); sleep(2)
check("Cmd+, settings", m.js("return document.getElementById('tabmail').currentTabInfo.mode.name") == "preferencesTab", None)
m.js("const t=document.getElementById('tabmail'); t.closeTab(t.currentTabInfo);"); sleep(1)

# ---------------------------------------------------------------- unsubscribe + open links
reset()
m.js(A3 + "s.openExternal = url => { s._opened = (s._opened || []).concat(url); };")
reset("other", 0)
m.js(A3 + "for (let i=0;i<a.gDBView.rowCount;i++) if (/Top products/.test(a.gDBView.getMsgHdrAt(i).mime2DecodedSubject)) { a.threadTree.selectedIndex=i; break; }")
mid = cur_mid(); key("u", metaKey=True); sleep(1.5); info = look(mid); opened = m.js(A3 + "return s._opened || []")
check("Cmd+U unsubscribe (opens link + archives)", "https://example.com/unsubscribe?u=42" in opened and info and info["folder"] != "Inbox", [opened, info])
reset(); key("Enter")
m.js(A3 + "s._bodyDocument().body.insertAdjacentHTML('beforeend', '<a href=\"https://example.com/x\">x</a>')")
key("o", metaKey=True); sleep(0.5)
check("Cmd+O open links", "https://example.com/x" in (m.js(A3 + "return s._opened || []") or []), m.js(A3 + "return s._opened || []"))
key("Escape")

# ---------------------------------------------------------------- read receipts
m.js(A3 + "s.go('SentMail')"); sleep(2)
m.js(A3 + "return s.refreshReceipts(true)"); sleep(3)
rec = m.js(A3 + """
return [...a.document.querySelectorAll('#threadTree .superhuman-receipt')].filter(e => !e.hidden).map(e => [e.dataset.state, e.textContent]);""")
print("receipt cells:", rec, flush=True)
check("Receipts column shows Seen N", any(r[0] == "opened" and r[1].startswith("Seen ") for r in rec), rec)
check("Receipts column shows unopened", any(r[0] == "unopened" for r in rec), rec)
shot(OUT + "-sent-receipts.png", settle=1)
idx = m.js(A3 + """
for (let i = 0; i < a.gDBView.rowCount; i++) { const h = a.gDBView.getMsgHdrAt(i);
  const id = s.receiptIdOf(h); const o = id && SuperhumanReceipts.opensFor(id); if (o && o.length) return i; } return -1;""".replace("SuperhumanReceipts", "a.SuperhumanReceipts"))
m.js(A3 + "a.threadTree.selectedIndex = arguments[0]; s.openReading();", idx); sleep(3)
m.js(A3 + "const p = a.messageBrowser.contentDocument.getElementById('superhumanSeen'); if (p) p.classList.add('open');")
seen = m.js(A3 + "const p = a.messageBrowser.contentDocument.getElementById('superhumanSeen'); return p ? p.innerText : null")
print("seen panel:", repr(seen), flush=True)
check("Message shows 'Opened N times'", bool(seen) and "Opened" in seen, seen)
shot(OUT + "-seen.png", settle=1)

passed = sum(ok for _, ok in results)
print("SUMMARY", passed, "/", len(results), flush=True)
print("FAILED:", [n for n, ok in results if not ok], flush=True)
