# Opens Local Folders/Inbox in the 3-pane tab and waits until rows render.
OPEN_INBOX_JS = """
const tabmail = document.getElementById('tabmail');
const about3 = tabmail.currentAbout3Pane;
const {MailServices} = ChromeUtils.importESModule('resource:///modules/MailServices.sys.mjs');
const inbox = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed('Inbox');
about3.displayFolder(inbox.URI);
return inbox.URI;
"""
ROWS_JS = """
const about3 = document.getElementById('tabmail').currentAbout3Pane;
const tree = about3.document.getElementById('threadTree');
return {folder: about3.gFolder && about3.gFolder.URI, rows: about3.gDBView ? about3.gDBView.rowCount : -1,
        domRows: tree ? tree.querySelectorAll('tr[is]').length + tree.querySelectorAll('tbody tr').length : -1};
"""


def open_inbox(m, sleep):
    m.js(OPEN_INBOX_JS)
    for _ in range(40):
        r = m.js(ROWS_JS)
        if r and r.get("rows", 0) > 0:
            break
        sleep(0.5)
    return r


def select_row(m, i):
    return m.js("""
const about3 = document.getElementById('tabmail').currentAbout3Pane;
about3.threadTree.selectedIndex = arguments[0];
return about3.gDBView.hdrForFirstSelectedMessage.mime2DecodedSubject;
""", i)
