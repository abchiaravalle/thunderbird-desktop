import os, sys
sys.path.insert(0, os.path.expanduser("~/src/tb-glass/tools"))
from tbhelpers import open_inbox
OUT = os.environ.get("SHOT_PREFIX", "/tmp/tb")
m.s.settimeout(60)
open_inbox(m, sleep)
A3 = "const a=document.getElementById('tabmail').currentAbout3Pane; const s=a.superhuman;"
sleep(3)
m.js(A3 + "a.threadTree.selectedIndex = 0; a.threadTree.table.body.focus();")
shot(OUT + "-inbox.png", settle=1.5)
idx = m.js(A3 + "for (let i=0;i<a.gDBView.rowCount;i++){const h=a.gDBView.getMsgHdrAt(i); if (/Q2 Review/.test(h.mime2DecodedSubject)) return i;} return 1;")
m.js(A3 + "a.threadTree.selectedIndex = arguments[0]; s.openReading();", idx)
sleep(3)
print("thread lines:", m.js(A3 + "const d=a.messageBrowser.contentDocument; return [...d.querySelectorAll('.sh-collapsed, .sh-fromline')].map(e=>e.innerText.replace(/\\s+/g,' ').slice(0,80))"), flush=True)
shot(OUT + "-message.png", settle=1)
print("errors:", m.js("""const msgs = Services.console.getMessageArray() || [];
return msgs.filter(x => x instanceof Ci.nsIScriptError && !(x.flags & 1)).map(x => x.errorMessage.slice(0,160) + ' @' + (x.sourceName||'').split('/').pop() + ':' + x.lineNumber).filter(s => /superhuman|thread-card|about3Pane|aboutMessage/.test(s)).slice(-8)"""), flush=True)
m.js(A3 + "s.closeReading(); s.toast('Marked done', true)")
shot(OUT + "-toast.png", settle=0.5)
m.js(A3 + "s.openPalette()")
shot(OUT + "-palette.png", settle=0.8)
