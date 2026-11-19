/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Superhuman-style interaction layer for the 3-pane mail tab.
 *
 * Everything here is gated on the `mail.superhuman.enabled` pref. When it is
 * false the 3-pane behaves exactly like stock Thunderbird.
 *
 * - Split inbox tabs above the message list (tag-based, with unread counts).
 * - Single-line rows: sender column, label chips, subject + grey preview,
 *   read-receipt column, time.
 * - Full-width reading: Enter opens the selected conversation in place of the
 *   list, Escape goes back. Sent mail with a receipt shows "Opened N times".
 * - Superhuman's keyboard map, including G-then jumps and selection keys.
 * - Command palette on Cmd+K listing every action and its key.
 */

/* globals gFolder, gDBView, gViewWrapper, threadTree, paneLayout,
   quickFilterBar, commandController, displayFolder, goDoCommand,
   MailServices, messageBrowser */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  SuperhumanReceipts: "chrome://messenger/content/superhumanReceipts.sys.mjs",
});

var superhuman = {
  PREF: "mail.superhuman.enabled",
  RECEIPT_HEADER: "x-superhuman-receipt",
  get enabled() {
    return Services.prefs.getBoolPref(this.PREF, false);
  },

  /** Split inbox definitions: label, chip colour, and how to filter. */
  SPLITS: [
    { id: "important", label: "Important", chip: "#e99bc3", tags: { $label1: true } },
    { id: "team", label: "Team", chip: "#ec9e8d", tags: { $label2: true } },
    { id: "personal", label: "Personal", chip: "#9cc88a", tags: { $label3: true } },
    { id: "travel", label: "Travel", chip: "#7fb7bb", tags: { $label4: true } },
    { id: "todo", label: "To Do", chip: "#a99ee8", tags: { $label5: true } },
    { id: "other", label: "Other", mode: "NONE" },
  ],

  /**
   * Chip for a tag key in the list: the split's own name and pastel colour
   * when a split uses that tag, otherwise the tag's name. Returns null for
   * the label of the split being viewed (Superhuman never repeats it).
   */
  chipFor(key) {
    const split = this.SPLITS.find(s => s.tags && key in s.tags);
    if (split) {
      return split.id == this.activeSplit
        ? null
        : { text: split.label.toLowerCase(), color: split.chip };
    }
    try {
      const tag = MailServices.tags.getAllTags().find(t => t.key == key);
      return tag ? { text: tag.tag.toLowerCase(), color: tag.color || "#b0b0b5" } : null;
    } catch {
      return null;
    }
  },

  activeSplit: "important",
  reading: false,
  _gPending: null,
  _undo: null,
  _linkIndex: -1,

  init() {
    if (!this.enabled) {
      return;
    }
    this._previewQueue = new Set();
    document.body.classList.add("superhuman");
    const showFolders = Services.prefs.getBoolPref(
      "mail.superhuman.folders-visible",
      false
    );
    paneLayout.folderPaneSplitter.isCollapsed = !showFolders;
    document.body.classList.toggle("superhuman-folders-open", showFolders);
    this._buildSplitBar();
    this._buildPalette();
    this._buildToast();
    window.addEventListener("keydown", this, true);
    threadTree.addEventListener("dblclick", this, true);
    threadTree.addEventListener("select", this);
    Services.obs.addObserver(this, "superhuman-refresh");
    Services.obs.addObserver(this, "superhuman-receipts-updated");
    window.addEventListener("unload", () => {
      Services.obs.removeObserver(this, "superhuman-refresh");
      Services.obs.removeObserver(this, "superhuman-receipts-updated");
      clearInterval(this._receiptTimer);
    });
    try {
      messageBrowser.contentWindow.addEventListener("MsgLoaded", event =>
        this.onMessageLoaded(event.detail)
      );
      messageBrowser.contentWindow.addEventListener("keydown", this, true);
    } catch (e) {
      console.error(e);
    }
    this._receiptTimer = setInterval(() => this.refreshReceipts(), 60000);
  },

  /* ---------------------------------------------------------------- splits */

  _buildSplitBar() {
    const bar = document.createElement("nav");
    bar.id = "superhumanSplits";
    bar.setAttribute("role", "tablist");

    const menu = document.createElement("button");
    menu.id = "superhumanMenuButton";
    menu.className = "superhuman-menu";
    menu.title = "Folders (←)";
    menu.setAttribute("aria-label", "Folders");
    menu.addEventListener("click", () => this.toggleFolders());
    bar.appendChild(menu);

    for (const split of this.SPLITS) {
      const tab = document.createElement("button");
      tab.className = "superhuman-split";
      tab.dataset.split = split.id;
      tab.setAttribute("role", "tab");
      tab.tabIndex = -1;
      const name = document.createElement("span");
      name.className = "split-name";
      name.textContent = split.label;
      const count = document.createElement("span");
      count.className = "split-count";
      tab.append(name, count);
      tab.addEventListener("click", () => this.selectSplit(split.id));
      bar.appendChild(tab);
    }

    const spacer = document.createElement("span");
    spacer.className = "superhuman-spacer";
    bar.appendChild(spacer);

    const search = document.createElement("button");
    search.className = "superhuman-pill";
    search.textContent = "Search";
    search.title = "Search (/)";
    search.addEventListener("click", () => this.focusSearch());
    const palette = document.createElement("button");
    palette.className = "superhuman-pill superhuman-kbd";
    palette.textContent = "⌘K";
    palette.title = "Command palette";
    palette.addEventListener("click", () => this.openPalette());
    bar.append(search, palette);

    const threadPaneEl = document.getElementById("threadPane");
    threadPaneEl.insertBefore(bar, threadPaneEl.firstChild);
    this._splitBar = bar;
    this._reflectSplit();
  },

  _isInbox() {
    return !!(gFolder && gFolder.getFlag(Ci.nsMsgFolderFlags.Inbox));
  },

  selectSplit(id, { focusList = true } = {}) {
    const split = this.SPLITS.find(s => s.id == id);
    if (!split) {
      return;
    }
    this.activeSplit = id;
    if (this.reading) {
      this.closeReading();
    }
    const value = split.mode
      ? { mode: split.mode, tags: {} }
      : { mode: "OR", tags: { ...split.tags } };
    if (this._isInbox()) {
      quickFilterBar.filterer.setFilterValue("tags", value);
      quickFilterBar.updateSearch();
    }
    this._reflectSplit();
    if (focusList) {
      this._focusList();
    }
  },

  /** Show the whole inbox with no split filter (G then A). */
  showAll() {
    this.activeSplit = null;
    quickFilterBar.filterer.setFilterValue("tags", null);
    quickFilterBar.updateSearch();
    this._reflectSplit();
    this._focusList();
  },

  cycleSplit(delta) {
    const i = Math.max(
      0,
      this.SPLITS.findIndex(s => s.id == this.activeSplit)
    );
    const n = this.SPLITS.length;
    this.selectSplit(this.SPLITS[(i + delta + n) % n].id);
  },

  /** Called when the displayed folder changes. */
  onFolderChanged() {
    if (!this.enabled || !this._splitBar) {
      return;
    }
    this._splitBar.hidden = !this._isInbox();
    if (this._isInbox() && this.activeSplit) {
      this.selectSplit(this.activeSplit, { focusList: false });
    }
    this.updateCounts();
    setTimeout(() => this.refreshReceipts(), 300);
  },

  _reflectSplit() {
    for (const tab of this._splitBar.querySelectorAll(".superhuman-split")) {
      const on = tab.dataset.split == this.activeSplit;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on);
    }
  },

  updateCounts() {
    if (!this._splitBar || !gFolder) {
      return;
    }
    const counts = Object.fromEntries(this.SPLITS.map(s => [s.id, 0]));
    try {
      for (const hdr of gFolder.messages) {
        if (hdr.isRead) {
          continue;
        }
        const keys = (hdr.getStringProperty("keywords") || "")
          .split(" ")
          .filter(Boolean);
        if (!keys.length) {
          counts.other++;
          continue;
        }
        for (const split of this.SPLITS) {
          if (split.tags && keys.some(k => k in split.tags)) {
            counts[split.id]++;
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
    for (const tab of this._splitBar.querySelectorAll(".superhuman-split")) {
      const c = counts[tab.dataset.split];
      tab.querySelector(".split-count").textContent = c ? String(c) : "";
    }
  },

  /* ------------------------------------------------------------------ date */

  _fmtTime: new Intl.DateTimeFormat(undefined, { timeStyle: "short" }),
  _fmtDay: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
  _fmtYear: new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }),
  _fmtFull: new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }),

  _shortDate(d) {
    const now = new Date();
    if (d.toDateString() == now.toDateString()) {
      return this._fmtTime.format(d);
    }
    return d.getFullYear() == now.getFullYear()
      ? this._fmtDay.format(d)
      : this._fmtYear.format(d);
  },

  /**
   * Superhuman's list date: the time for today, "Nov 17" this year, and
   * "Nov 17, 2025" for older mail.
   *
   * @param {integer} index - Row index in the view.
   * @returns {?string}
   */
  dateFor(index) {
    if (!this.enabled || !gDBView) {
      return null;
    }
    try {
      return this._shortDate(new Date(gDBView.getMsgHdrAt(index).date / 1000));
    } catch {
      return null;
    }
  },

  /* --------------------------------------------------------------- preview */

  /**
   * Fill the grey preview after the subject in a card row. Messages without a
   * stored preview are fetched in a batch; rows are refreshed when ready.
   */
  previewFor(index) {
    if (!this.enabled || !gDBView || !this._previewQueue) {
      return "";
    }
    let hdr;
    try {
      hdr = gDBView.getMsgHdrAt(index);
    } catch {
      return "";
    }
    const preview = hdr.getStringProperty("preview");
    if (preview) {
      return preview.replace(/\s+/g, " ").trim();
    }
    if (!this._previewQueue.has(hdr.messageKey)) {
      this._previewQueue.add(hdr.messageKey);
      this._schedulePreviewFetch(hdr.folder);
    }
    return "";
  },

  _schedulePreviewFetch(folder) {
    if (this._previewTimer) {
      return;
    }
    this._previewTimer = setTimeout(() => {
      this._previewTimer = null;
      const keys = [...this._previewQueue];
      this._previewQueue.clear();
      try {
        const async = folder.fetchMsgPreviewText(keys, {
          OnStartRunningUrl() {},
          OnStopRunningUrl: () => threadTree.invalidate(),
        });
        if (!async) {
          threadTree.invalidate();
        }
      } catch (e) {
        console.error(e);
      }
    }, 50);
  },

  /* -------------------------------------------------------- read receipts */

  receiptIdOf(hdr) {
    return hdr?.getStringProperty(this.RECEIPT_HEADER) || "";
  },

  /**
   * Receipt state for a row: null when the message carries no receipt,
   * otherwise { opens: Array|null } (null while not fetched yet).
   */
  receiptFor(index) {
    if (!this.enabled || !gDBView) {
      return null;
    }
    let hdr;
    try {
      hdr = gDBView.getMsgHdrAt(index);
    } catch {
      return null;
    }
    const id = this.receiptIdOf(hdr);
    if (!id) {
      return null;
    }
    return { id, opens: SuperhumanReceipts.opensFor(id) };
  },

  async refreshReceipts(force = false) {
    if (!this.enabled || !gDBView || !SuperhumanReceipts.configured) {
      return false;
    }
    const ids = [];
    const n = Math.min(gDBView.rowCount, 600);
    for (let i = 0; i < n; i++) {
      try {
        const id = this.receiptIdOf(gDBView.getMsgHdrAt(i));
        if (id) {
          ids.push(id);
        }
      } catch {}
    }
    const current = this._currentMessageHdr();
    const cid = this.receiptIdOf(current);
    if (cid) {
      ids.push(cid);
    }
    return SuperhumanReceipts.refresh(ids, force);
  },

  _currentMessageHdr() {
    try {
      return messageBrowser.contentWindow.gMessage || null;
    } catch {
      return null;
    }
  },

  _kindLabel(kind) {
    return (
      {
        phone: "Phone",
        desktop: "Computer",
        gmail: "Gmail",
        yahoo: "Yahoo Mail",
        "apple-privacy": "Apple Mail (may be automatic)",
      }[kind] || "Opened"
    );
  },

  onMessageLoaded(hdr) {
    const doc = messageBrowser.contentDocument;
    let panel = doc.getElementById("superhumanSeen");
    const id = this.receiptIdOf(hdr);
    if (!this.enabled || !id) {
      panel?.remove();
      return;
    }
    if (!panel) {
      panel = doc.createElement("div");
      panel.id = "superhumanSeen";
      panel.addEventListener("click", () => panel.classList.toggle("open"));
    }
    const anchor =
      doc.getElementById("superhumanThread") ??
      doc.getElementById("singleMessage");
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    panel.dataset.rid = id;
    this._renderSeen(panel, SuperhumanReceipts.opensFor(id));
    SuperhumanReceipts.refresh([id]);
  },

  _renderSeen(panel, opens) {
    const doc = panel.ownerDocument;
    panel.textContent = "";
    const title = doc.createElement("div");
    title.className = "seen-title";
    if (opens == null) {
      title.textContent = SuperhumanReceipts.configured
        ? "Checking for opens…"
        : "Read receipts are not set up";
      panel.dataset.state = "pending";
    } else if (!opens.length) {
      title.textContent = "Not opened yet";
      panel.dataset.state = "unopened";
    } else {
      title.textContent =
        opens.length == 1 ? "Opened once" : `Opened ${opens.length} times`;
      panel.dataset.state = "opened";
    }
    panel.appendChild(title);
    if (opens?.length) {
      const list = doc.createElement("ol");
      list.className = "seen-list";
      for (const open of [...opens].reverse()) {
        const li = doc.createElement("li");
        li.dataset.kind = open.kind || "";
        const where = doc.createElement("span");
        where.className = "seen-where";
        const place = [open.city, open.country].filter(Boolean).join(", ");
        where.textContent = place
          ? `${this._kindLabel(open.kind)} · ${place}`
          : this._kindLabel(open.kind);
        const when = doc.createElement("span");
        when.className = "seen-when";
        when.textContent = this._fmtFull.format(new Date(open.t));
        li.append(where, when);
        list.appendChild(li);
      }
      panel.appendChild(list);
    }
  },

  /* --------------------------------------------------------------- reading */

  /** Newest message of the conversation at a list index. */
  _newestInThread(index) {
    let best = null;
    try {
      const thread = gDBView.getThreadContainingIndex(index);
      for (let i = 0; i < thread.numChildren; i++) {
        const hdr = thread.getChildHdrAt(i);
        if (hdr && (!best || hdr.date > best.date)) {
          best = hdr;
        }
      }
    } catch {}
    return best;
  },

  openReading() {
    if (!gDBView || threadTree.currentIndex < 0) {
      return;
    }
    let index = threadTree.currentIndex;
    // A conversation opens on its newest message; the earlier ones show as
    // one line each above it (superhumanThread.js).
    const messages = this._threadMessages(index);
    if (messages.length > 1) {
      const newest = messages.at(-1);
      if (newest) {
        const root = gDBView.findIndexOfMsgHdr(messages[0], false);
        if (
          root >= 0 &&
          root != 0xffffffff &&
          gDBView.isContainer(root) &&
          !gDBView.isContainerOpen(root)
        ) {
          gDBView.toggleOpenState(root);
          this._expandedRoot = gDBView.getMsgHdrAt(root);
        }
        const found = gDBView.findIndexOfMsgHdr(newest, true);
        if (found != 0xffffffff && found >= 0) {
          index = found;
        }
      }
    }
    if (gDBView.numSelected != 1 || threadTree.selectedIndex != index) {
      threadTree._selectSingle(index);
    }
    this._picking = false;
    this.reading = true;
    this._linkIndex = -1;
    document.body.classList.add("superhuman-reading");
    paneLayout.messagePaneSplitter.isCollapsed = false;
    document.getElementById("messagePane").focus();
  },

  closeReading() {
    this.reading = false;
    document.body.classList.remove("superhuman-reading");
    if (this._expandedRoot && gDBView) {
      try {
        const root = gDBView.findIndexOfMsgHdr(this._expandedRoot, false);
        if (root != 0xffffffff && root >= 0 && gDBView.isContainerOpen(root)) {
          gDBView.toggleOpenState(root);
          threadTree._selectSingle(root);
        }
      } catch {}
      this._expandedRoot = null;
    }
    this._focusList();
  },

  _focusList() {
    threadTree.table.body.focus();
    if (gDBView?.rowCount && threadTree.currentIndex < 0) {
      threadTree.selectedIndex = 0;
    }
  },

  toggleFolders() {
    const splitter = paneLayout.folderPaneSplitter;
    splitter.isCollapsed = !splitter.isCollapsed;
    document.body.classList.toggle(
      "superhuman-folders-open",
      !splitter.isCollapsed
    );
    Services.prefs.setBoolPref(
      "mail.superhuman.folders-visible",
      !splitter.isCollapsed
    );
  },

  /** /: search mail. Opens the palette in search mode; Enter filters the list. */
  focusSearch() {
    this.openPalette("", "search");
  },

  applySearch(text) {
    text = text.trim();
    quickFilterBar.filterer.setFilterValue("text", {
      text: text || null,
      states: { recipients: true, sender: true, subject: true, body: false },
    });
    quickFilterBar.updateSearch();
    this.searchText = text;
    this.toast(text ? `Search: ${text} (Esc clears)` : "Search cleared");
  },

  /** The displayed message's body document, when reading. */
  _bodyDocument() {
    try {
      return messageBrowser.contentDocument.getElementById("messagepane")
        .contentDocument;
    } catch {
      return null;
    }
  },

  scrollMessage(direction) {
    if (this.reading) {
      const win = this._bodyDocument()?.defaultView;
      win?.scrollByPages(direction);
      return;
    }
    const rows = Math.max(1, Math.floor(threadTree.clientHeight / 44) - 1);
    this.move(direction * rows);
  },

  jump(toEnd) {
    if (this.reading) {
      const win = this._bodyDocument()?.defaultView;
      win?.scrollTo(0, toEnd ? win.document.body.scrollHeight : 0);
      return;
    }
    const max = gDBView ? gDBView.rowCount - 1 : -1;
    if (max < 0) {
      return;
    }
    const index = toEnd ? max : 0;
    threadTree.selectedIndex = index;
    threadTree.scrollToIndex(index);
  },

  /** Tab in a conversation: focus the next link in the message body. */
  cycleLinks(delta) {
    const doc = this._bodyDocument();
    const links = doc ? [...doc.querySelectorAll("a[href]")] : [];
    if (!links.length) {
      this.toast("No links in this message");
      return;
    }
    const n = links.length;
    this._linkIndex = (this._linkIndex + delta + n) % n;
    const link = links[this._linkIndex];
    link.focus();
    link.scrollIntoView({ block: "nearest" });
  },

  openExternal(url) {
    if (url.startsWith("mailto:")) {
      MailServices.compose.OpenComposeWindowWithURI(
        null,
        Services.io.newURI(url)
      );
      return;
    }
    Cc["@mozilla.org/uriloader/external-protocol-service;1"]
      .getService(Ci.nsIExternalProtocolService)
      .loadURI(Services.io.newURI(url));
  },

  /** Messages of the conversation at a list index, oldest first. */
  _threadMessages(index) {
    const out = [];
    try {
      const thread = gDBView.getThreadContainingIndex(index);
      for (let i = 0; i < thread.numChildren; i++) {
        const hdr = thread.getChildHdrAt(i);
        if (hdr) {
          out.push(hdr);
        }
      }
    } catch {}
    return out.sort((a, b) => a.date - b.date);
  },

  /** N / P: next or previous message inside the open conversation. */
  stepMessage(delta) {
    if (!this.reading) {
      this.move(delta);
      return;
    }
    const index = threadTree.currentIndex;
    const current = gDBView.hdrForFirstSelectedMessage;
    const messages = this._threadMessages(index);
    const at = messages.findIndex(h => h.messageKey == current?.messageKey);
    const next = messages[at + delta];
    if (!next) {
      this.toast(delta > 0 ? "Last message" : "First message");
      return;
    }
    const found = gDBView.findIndexOfMsgHdr(next, true);
    if (found >= 0 && found != 0xffffffff) {
      threadTree._selectSingle(found);
    }
  },

  /** Newest message of the conversation under the cursor, selected. */
  _selectNewest() {
    const index = threadTree.currentIndex;
    if (index < 0 || !gDBView.isContainer(index)) {
      return;
    }
    const newest = this._newestInThread(index);
    if (!newest) {
      return;
    }
    if (!gDBView.isContainerOpen(index)) {
      gDBView.toggleOpenState(index);
      this._expandedRoot = gDBView.getMsgHdrAt(index);
    }
    const found = gDBView.findIndexOfMsgHdr(newest, true);
    if (found >= 0 && found != 0xffffffff) {
      threadTree._selectSingle(found);
    }
  },

  /** R / Enter: reply in the conversation, like Superhuman (inline box). */
  reply(all) {
    if (this.reading && this._inlineReply(all)) {
      return;
    }
    if (!this.reading && Services.prefs.getBoolPref("mail.superhuman.inline-reply", true)) {
      this.openReading();
      // The conversation (and its reply box) is built once the message loads.
      let tries = 0;
      const wait = setInterval(() => {
        if (this._inlineReply(all) || ++tries > 40) {
          clearInterval(wait);
        }
      }, 100);
      return;
    }
    commandController.doCommand(all ? "cmd_replyall" : "cmd_replySender");
  },

  /** ⌘= / ⌘- / ⌘0: the whole app's text size, list and messages alike. */
  textSize(direction) {
    const { UIFontSize } = ChromeUtils.importESModule(
      "resource:///modules/UIFontSize.sys.mjs"
    );
    if (direction > 0) {
      UIFontSize.increaseSize();
    } else if (direction < 0) {
      UIFontSize.reduceSize();
    } else {
      UIFontSize.resetSize();
    }
    this.toast(`Text size ${UIFontSize.size}`);
  },

  /** Focus Superhuman's inline reply box under the open message. */
  _inlineReply(all = true) {
    if (!Services.prefs.getBoolPref("mail.superhuman.inline-reply", true)) {
      return false;
    }
    try {
      return (
        messageBrowser.contentWindow.superhumanThread?.focusReply(all) ?? false
      );
    } catch {
      return false;
    }
  },

  /** Cmd+O: open the links and attachments of the open message. */
  openLinks() {
    if (!this.reading) {
      this.openReading();
      return;
    }
    const doc = this._bodyDocument();
    const urls = doc
      ? [...doc.querySelectorAll("a[href]")]
          .map(a => a.href)
          .filter(href => /^(https?|mailto):/i.test(href))
      : [];
    const unique = [...new Set(urls)].slice(0, 5);
    for (const url of unique) {
      this.openExternal(url);
    }
    const attachments = messageBrowser.contentWindow.currentAttachments || [];
    for (const attachment of attachments.slice(0, 5)) {
      attachment.open?.(messageBrowser.contentWindow.browsingContext);
    }
    if (!unique.length && !attachments.length) {
      this.toast("No links or attachments");
    }
  },

  /* -------------------------------------------------------------- actions */

  /** Every action: id, label, key hint, function. Used by keys + palette. */
  get actions() {
    const cmd = c => () => commandController.doCommand(c);
    return [
      { id: "done", label: "Mark Done", key: "E", run: () => this.done() },
      { id: "notdone", label: "Mark Not Done (back to Inbox)", key: "⇧E", run: () => this.notDone() },
      { id: "remind", label: "Remind Me (stars it)", key: "H", run: () => this.remind() },
      { id: "star", label: "Star / unstar", key: "S", run: cmd("cmd_markAsFlagged") },
      { id: "unread", label: "Mark read / unread", key: "U", run: () => this.toggleRead() },
      { id: "trash", label: "Trash", key: "#", run: () => this.trash() },
      { id: "spam", label: "Mark spam", key: "!", run: () => this.spam() },
      { id: "mute", label: "Mute conversation", key: "⇧M", run: () => this.mute() },
      { id: "unsubscribe", label: "Unsubscribe", key: "⌘U", run: () => this.unsubscribe() },
      { id: "compose", label: "Compose", key: "C", run: cmd("cmd_newMessage") },
      { id: "reply", label: "Reply", key: "R", run: () => this.reply(false) },
      { id: "replyall", label: "Reply all", key: "↩", run: () => this.reply(true) },
      { id: "forward", label: "Forward", key: "F", run: () => { this._selectNewest(); commandController.doCommand("cmd_forwardInline"); } },
      { id: "label", label: "Add label", key: "L", run: () => this.openPalette("label:") },
      { id: "removelabel", label: "Remove this split's label", key: "Y", run: () => this.removeSplitLabel(0) },
      { id: "removelabelnext", label: "Remove label, then next", key: "[", run: () => this.removeSplitLabel(1) },
      { id: "removelabelprev", label: "Remove label, then previous", key: "]", run: () => this.removeSplitLabel(-1) },
      { id: "removelabels", label: "Remove all labels", key: "⇧Y", run: cmd("cmd_removeTags") },
      { id: "move", label: "Move to folder", key: "V", run: () => this.openPalette("move:") },
      { id: "undo", label: "Undo", key: "Z", run: () => this.undo() },
      { id: "select", label: "Select conversation", key: "X", run: () => this.toggleSelect() },
      { id: "selectdown", label: "Add to selection (down)", key: "⇧J", run: () => this.extendSelection(1) },
      { id: "selectup", label: "Add to selection (up)", key: "⇧K", run: () => this.extendSelection(-1) },
      { id: "selectfromhere", label: "Select all from here", key: "⌘A", run: () => this.selectFromHere() },
      { id: "selectall", label: "Select all", key: "⌘⇧A", run: () => threadTree.selectAll() },
      { id: "next", label: "Next conversation", key: "J", run: () => this.move(1) },
      { id: "prev", label: "Previous conversation", key: "K", run: () => this.move(-1) },
      { id: "nextmsg", label: "Next message in conversation", key: "N", run: () => this.stepMessage(1) },
      { id: "prevmsg", label: "Previous message in conversation", key: "P", run: () => this.stepMessage(-1) },
      { id: "open", label: "Open conversation", key: "↩", run: () => this.openReading() },
      { id: "back", label: "Back to list", key: "Esc", run: () => this.closeReading() },
      { id: "expand", label: "Expand / collapse conversation", key: "O", run: () => this.toggleThread() },
      { id: "expandall", label: "Expand all conversations", key: "⇧O", run: cmd("cmd_expandAllThreads") },
      { id: "openlinks", label: "Open links and attachments", key: "⌘O", run: () => this.openLinks() },
      { id: "cyclelinks", label: "Cycle through links (in a message)", key: "Tab", run: () => this.cycleLinks(1) },
      { id: "scrolldown", label: "Scroll down", key: "Space", run: () => this.scrollMessage(1) },
      { id: "scrollup", label: "Scroll up", key: "⇧Space", run: () => this.scrollMessage(-1) },
      { id: "top", label: "Jump to top", key: "⌘↑", run: () => this.jump(false) },
      { id: "bottom", label: "Jump to bottom", key: "⌘↓", run: () => this.jump(true) },
      { id: "search", label: "Search", key: "/", run: () => this.focusSearch() },
      { id: "shortcuts", label: "Keyboard shortcuts", key: "?", run: () => this.openPalette() },
      { id: "filterunread", label: "Show unread only", key: "⇧U", run: () => this.toggleFilter("unread") },
      { id: "filterstarred", label: "Show starred only", key: "⇧S", run: () => this.toggleFilter("starred") },
      { id: "filterimportant", label: "Show important only", key: "⇧I", run: () => this.selectSplit("important") },
      { id: "filternoreply", label: "Show waiting on a reply", key: "⇧R", run: () => this.toggleNoReply() },
      { id: "nextsplit", label: "Next split", key: "Tab", run: () => this.cycleSplit(1) },
      { id: "prevsplit", label: "Previous split", key: "⇧Tab", run: () => this.cycleSplit(-1) },
      { id: "folders", label: "Show / hide folders", key: "←", run: () => this.toggleFolders() },
      { id: "newwindow", label: "New window", key: "⌘N", run: () => this.newWindow() },
      { id: "bigger", label: "Bigger text", key: "⌘=", run: () => this.textSize(1) },
      { id: "smaller", label: "Smaller text", key: "⌘-", run: () => this.textSize(-1) },
      { id: "resettext", label: "Reset text size", key: "⌘0", run: () => this.textSize(0) },
      { id: "copylink", label: "Copy message link", key: "⌃/", run: () => this.copyLink() },
      { id: "settings", label: "Settings", key: "⌘,", run: () => top.openPreferencesTab() },
      { id: "receipts", label: "Refresh read receipts", key: "", run: () => this.refreshReceipts(true) },
      { id: "goimportant", label: "Go to Important", key: "G I", run: () => this.goSplit("important") },
      { id: "goother", label: "Go to Other", key: "G O", run: () => this.goSplit("other") },
      { id: "gostarred", label: "Go to Starred", key: "G S", run: () => this.goStarred() },
      { id: "godrafts", label: "Go to Drafts", key: "G D", run: () => this.go("Drafts") },
      { id: "gosent", label: "Go to Sent", key: "G T", run: () => this.go("SentMail") },
      { id: "godone", label: "Go to Done", key: "G E", run: () => this.go("Archive") },
      { id: "goreminders", label: "Go to Reminders (starred)", key: "G H", run: () => this.goStarred() },
      { id: "gomuted", label: "Go to Muted", key: "G M", run: () => this.goMuted() },
      { id: "gosnippets", label: "Go to Snippets (templates)", key: "G ;", run: () => this.go("Templates") },
      { id: "gospam", label: "Go to Spam", key: "G !", run: () => this.go("Junk") },
      { id: "gotrash", label: "Go to Trash", key: "G #", run: () => this.go("Trash") },
      { id: "goall", label: "Go to All Mail", key: "G A", run: () => this.goAll() },
      { id: "golabel", label: "Go to label", key: "G L", run: () => this.openPalette("golabel:") },
      ...this.SPLITS.map(s => ({
        id: "split-" + s.id,
        label: "Split: " + s.label,
        key: "",
        run: () => this.selectSplit(s.id),
      })),
      ...this._accounts().map((account, i) => ({
        id: "account-" + i,
        label: "Switch to " + account.incomingServer.prettyName,
        key: i < 9 ? `⌃${i + 1}` : "",
        run: () => this.switchAccount(i),
      })),
    ];
  },

  _selectedHdrs() {
    return gDBView ? gDBView.getSelectedMsgHdrs() : [];
  },

  _remember(message) {
    this._undo = { message };
    this.toast(message, true);
  },

  done() {
    if (!this._selectedHdrs().length) {
      return;
    }
    this._remember("Marked done");
    commandController.doCommand("cmd_archive");
  },

  notDone() {
    const hdrs = this._selectedHdrs();
    const inbox = this._folderFor("Inbox", hdrs[0]?.folder.server);
    if (!hdrs.length || !inbox || gFolder == inbox) {
      return;
    }
    this._remember("Moved to Inbox");
    commandController.doCommand("cmd_moveMessage", inbox);
  },

  trash() {
    if (!this._selectedHdrs().length) {
      return;
    }
    this._remember("Moved to Trash");
    commandController.doCommand("cmd_delete");
  },

  spam() {
    if (!this._selectedHdrs().length) {
      return;
    }
    this._remember("Marked as spam");
    commandController.doCommand("cmd_markAsJunk");
  },

  mute() {
    if (!this._selectedHdrs().length) {
      return;
    }
    this._remember("Muted");
    commandController.doCommand("cmd_killThread");
  },

  toggleRead() {
    const hdrs = this._selectedHdrs();
    if (!hdrs.length) {
      return;
    }
    commandController.doCommand(
      hdrs.every(h => h.isRead) ? "cmd_markAsUnread" : "cmd_markAsRead"
    );
  },

  remind() {
    // Thunderbird has no snooze; mark for follow-up (star) and say so plainly.
    commandController.doCommand("cmd_markAsFlagged");
    this.toast("Starred to follow up");
  },

  removeSplitLabel(then) {
    const split = this.SPLITS.find(s => s.id == this.activeSplit);
    const hdrs = this._selectedHdrs();
    if (!split?.tags || !hdrs.length) {
      this.toast("No split label to remove here");
      return;
    }
    const index = threadTree.currentIndex;
    for (const key of Object.keys(split.tags)) {
      hdrs[0].folder.removeKeywordsFromMessages(hdrs, key);
    }
    this.toast(`Removed ${split.label}`);
    setTimeout(() => {
      const max = gDBView.rowCount - 1;
      if (max < 0) {
        return;
      }
      const next = Math.max(0, Math.min(max, index + (then < 0 ? -1 : 0)));
      threadTree.selectedIndex = next;
    }, 50);
  },

  undo() {
    if (!this._undo) {
      return;
    }
    goDoCommand("cmd_undo");
    this._undo = null;
    this.toast("Undone");
  },

  move(delta) {
    if (this.reading) {
      commandController.doCommand(delta > 0 ? "cmd_nextMsg" : "cmd_previousMsg");
      return;
    }
    const max = gDBView ? gDBView.rowCount - 1 : -1;
    if (max < 0) {
      return;
    }
    const cur = threadTree.currentIndex < 0 ? -1 : threadTree.currentIndex;
    const next = Math.max(0, Math.min(max, cur + delta));
    if (this._picking) {
      // Selecting with X: J/K move the cursor and keep the picked rows.
      threadTree.currentIndex = next;
      return;
    }
    threadTree.selectedIndex = next;
    threadTree.scrollToIndex(next);
  },

  /** X: tick the conversation under the cursor (Superhuman multi-select). */
  toggleSelect() {
    const index = threadTree.currentIndex;
    if (index < 0) {
      return;
    }
    if (!this._picking) {
      this._picking = true;
      threadTree.toggleSelectionAtIndex(index, true);
      return;
    }
    threadTree.toggleSelectionAtIndex(index);
  },

  extendSelection(delta) {
    this._picking = true;
    const max = gDBView ? gDBView.rowCount - 1 : -1;
    const cur = threadTree.currentIndex;
    const next = cur + delta;
    if (cur < 0 || next < 0 || next > max) {
      return;
    }
    threadTree.toggleSelectionAtIndex(cur, true, true);
    threadTree.toggleSelectionAtIndex(next, true);
    threadTree.currentIndex = next;
    threadTree.scrollToIndex(next);
  },

  selectFromHere() {
    const max = gDBView ? gDBView.rowCount - 1 : -1;
    const cur = Math.max(0, threadTree.currentIndex);
    if (max < 0) {
      return;
    }
    this._picking = true;
    for (let i = cur; i <= max; i++) {
      threadTree.toggleSelectionAtIndex(i, true, i < max);
    }
    threadTree.currentIndex = cur;
  },

  clearSelection() {
    const wasPicking = this._picking;
    this._picking = false;
    if (gDBView?.numSelected > 1 || (wasPicking && gDBView?.numSelected != 1)) {
      threadTree._selectSingle(Math.max(0, threadTree.currentIndex));
      return true;
    }
    return false;
  },

  toggleThread() {
    const index = threadTree.currentIndex;
    if (index < 0 || !gDBView) {
      return;
    }
    if (gDBView.isContainer(index)) {
      gDBView.toggleOpenState(index);
    } else {
      this.toast("Single message, nothing to expand");
    }
  },

  toggleFilter(name) {
    const on = !quickFilterBar.filterer.getFilterValue(name);
    quickFilterBar.filterer.setFilterValue(name, on || null);
    quickFilterBar.updateSearch();
    this.toast(on ? `Showing ${name} only` : `Showing all`);
  },

  /** Superhuman's "waiting on a reply": hide mail already replied to. */
  toggleNoReply() {
    this._defineNoReplyFilter();
    const on = !quickFilterBar.filterer.getFilterValue("superhumanNoReply");
    quickFilterBar.filterer.setFilterValue("superhumanNoReply", on || null);
    quickFilterBar.updateSearch();
    this.toast(on ? "Showing mail you haven't replied to" : "Showing all");
  },

  _defineNoReplyFilter() {
    const { QuickFilterManager } = ChromeUtils.importESModule(
      "resource:///modules/QuickFilterManager.sys.mjs"
    );
    if (QuickFilterManager.filterDefsByName.superhumanNoReply) {
      return;
    }
    QuickFilterManager.defineFilter({
      name: "superhumanNoReply",
      domId: "superhumanNoReply",
      appendTerms(termCreator, terms, value) {
        if (!value) {
          return;
        }
        const term = termCreator.createTerm();
        term.attrib = Ci.nsMsgSearchAttrib.MsgStatus;
        const v = term.value;
        v.attrib = term.attrib;
        v.status = Ci.nsMsgMessageFlags.Replied;
        term.value = v;
        term.op = Ci.nsMsgSearchOp.Isnt;
        term.booleanAnd = true;
        terms.push(term);
      },
    });
  },

  _accounts() {
    try {
      return MailServices.accounts.accounts.filter(a => a.incomingServer);
    } catch {
      return [];
    }
  },

  switchAccount(index) {
    const account = this._accounts()[index];
    if (!account) {
      return;
    }
    const root = account.incomingServer.rootFolder;
    const inbox =
      root.getFolderWithFlags(Ci.nsMsgFolderFlags.Inbox) ??
      root.getChildNamed("Inbox");
    if (this.reading) {
      this.closeReading();
    }
    displayFolder((inbox ?? root).URI);
    this.toast(account.incomingServer.prettyName);
    this._focusList();
  },

  _folderFor(kind, server) {
    const flags = {
      Inbox: Ci.nsMsgFolderFlags.Inbox,
      Drafts: Ci.nsMsgFolderFlags.Drafts,
      SentMail: Ci.nsMsgFolderFlags.SentMail,
      Archive: Ci.nsMsgFolderFlags.Archive,
      Junk: Ci.nsMsgFolderFlags.Junk,
      Trash: Ci.nsMsgFolderFlags.Trash,
      Templates: Ci.nsMsgFolderFlags.Templates,
    };
    server = server ?? gFolder?.server;
    return (
      server?.rootFolder.getFolderWithFlags(flags[kind]) ??
      MailServices.accounts.localFoldersServer?.rootFolder.getFolderWithFlags(
        flags[kind]
      ) ??
      MailServices.accounts.allFolders.find(f => f.getFlag(flags[kind])) ??
      null
    );
  },

  go(kind) {
    const folder = this._folderFor(kind);
    if (!folder) {
      this.toast(`No ${kind} folder`);
      return false;
    }
    if (this.reading) {
      this.closeReading();
    }
    displayFolder(folder.URI);
    this._focusList();
    return true;
  },

  goSplit(id) {
    if (!this._isInbox()) {
      this.go("Inbox");
    }
    this.selectSplit(id);
  },

  goAll() {
    if (!this._isInbox()) {
      this.go("Inbox");
    }
    this.showAll();
    this.toast("All mail");
  },

  goStarred() {
    if (!this._isInbox()) {
      this.go("Inbox");
    }
    this.showAll();
    quickFilterBar.filterer.setFilterValue("starred", true);
    quickFilterBar.updateSearch();
    this.toast("Showing starred");
  },

  goMuted() {
    if (!this._isInbox()) {
      this.go("Inbox");
    }
    this.showAll();
    if (!gViewWrapper.showIgnored) {
      gViewWrapper.showIgnored = true;
    }
    this.toast("Showing muted conversations");
  },

  newWindow() {
    top.MsgOpenNewWindowForFolder(gFolder?.URI, -1);
  },

  copyLink() {
    const hdr = this._selectedHdrs()[0];
    if (!hdr) {
      return;
    }
    const link = "mid:" + hdr.messageId;
    Cc["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Ci.nsIClipboardHelper)
      .copyString(link);
    this._lastCopied = link;
    this.toast("Link copied");
  },

  async unsubscribe() {
    const hdr = this._selectedHdrs()[0];
    if (!hdr) {
      return;
    }
    const uri = hdr.folder.getUriForMsg(hdr);
    const service = MailServices.messageServiceFromURI(uri);
    const text = await new Promise(resolve => {
      const chunks = [];
      service.streamHeaders(
        uri,
        {
          onStartRequest() {},
          onDataAvailable(request, stream, offset, count) {
            chunks.push(NetUtil.readInputStreamToString(stream, count));
          },
          onStopRequest() {
            resolve(chunks.join(""));
          },
          QueryInterface: ChromeUtils.generateQI(["nsIStreamListener"]),
        },
        null,
        true
      );
    });
    const match = /^list-unsubscribe:[ \t]*((?:.*)(?:\r?\n[ \t].*)*)/im.exec(text);
    const links = match
      ? [...match[1].matchAll(/<([^>]+)>/g)].map(m => m[1].trim())
      : [];
    const target =
      links.find(l => /^https:/i.test(l)) ??
      links.find(l => /^mailto:/i.test(l)) ??
      links.find(l => /^http:/i.test(l));
    if (!target) {
      this.toast("No unsubscribe link in this email");
      return;
    }
    this.openExternal(target);
    this._remember("Unsubscribed and archived");
    commandController.doCommand("cmd_archive");
  },

  /* ---------------------------------------------------------------- toast */

  _buildToast() {
    const t = document.createElement("div");
    t.id = "superhumanToast";
    t.setAttribute("role", "status");
    t.hidden = true;
    document.body.appendChild(t);
    this._toast = t;
  },

  toast(message, undoable = false) {
    const t = this._toast;
    if (!t) {
      return;
    }
    this.lastToast = message;
    t.textContent = "";
    const msg = document.createElement("span");
    msg.textContent = message;
    t.appendChild(msg);
    if (undoable) {
      const hint = document.createElement("span");
      hint.className = "toast-hint";
      hint.textContent = "Z to undo";
      t.appendChild(hint);
    }
    t.hidden = false;
    t.classList.remove("show");
    // Restart the transition.
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => (t.hidden = true), 250);
    }, 2600);
  },

  /* -------------------------------------------------------------- palette */

  _buildPalette() {
    const wrap = document.createElement("div");
    wrap.id = "superhumanPalette";
    wrap.hidden = true;
    const card = document.createElement("div");
    card.className = "palette-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Command palette");
    const input = document.createElement("input");
    input.className = "palette-input";
    input.type = "text";
    input.placeholder = "Type a command or search…";
    input.setAttribute("aria-label", "Command");
    const list = document.createElement("ul");
    list.className = "palette-list";
    list.setAttribute("role", "listbox");
    card.append(input, list);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    this._palette = wrap;
    this._paletteInput = input;
    this._paletteList = list;
    wrap.addEventListener("mousedown", e => {
      if (e.target == wrap) {
        this.closePalette();
      }
    });
    this._paletteInput.addEventListener("input", () => this._renderPalette());
    this._paletteInput.addEventListener("keydown", e => this._paletteKey(e));
  },

  _folderItems(q, run) {
    return MailServices.accounts.allFolders
      .filter(f => !f.isServer && !f.getFlag(Ci.nsMsgFolderFlags.Virtual))
      .filter(f => !q || f.prettyName.toLowerCase().includes(q))
      .slice(0, 40)
      .map(f => ({
        id: "folder-" + f.URI,
        label: `${f.prettyName} · ${f.server.prettyName}`,
        key: "",
        run: () => run(f),
      }));
  },

  _paletteItems(query) {
    if (this._paletteMode == "search") {
      const q = query.trim();
      return [
        {
          id: "search-run",
          label: q ? `Search mail for “${q}”` : "Type to search sender, recipients and subject",
          key: "↩",
          run: () => q && this.applySearch(q),
        },
      ];
    }
    const tagItems = (q, run) =>
      MailServices.tags
        .getAllTags()
        .filter(t => !q || t.tag.toLowerCase().includes(q))
        .map(t => ({
          id: "tag-" + t.key,
          label: "Label: " + t.tag,
          key: "",
          color: t.color,
          run: () => run(t),
        }));
    if (query.startsWith("label:")) {
      return tagItems(query.slice(6).trim().toLowerCase(), t => {
        commandController.doCommand("cmd_toggleTag", {
          target: { value: t.key },
        });
        this.toast(`Labeled ${t.tag}`);
      });
    }
    if (query.startsWith("golabel:")) {
      return tagItems(query.slice(8).trim().toLowerCase(), t => {
        if (!this._isInbox()) {
          this.go("Inbox");
        }
        this.activeSplit = null;
        quickFilterBar.filterer.setFilterValue("tags", {
          mode: "OR",
          tags: { [t.key]: true },
        });
        quickFilterBar.updateSearch();
        this._reflectSplit();
        this.toast(t.tag);
      });
    }
    if (query.startsWith("move:")) {
      return this._folderItems(query.slice(5).trim().toLowerCase(), f => {
        this._remember(`Moved to ${f.prettyName}`);
        commandController.doCommand("cmd_moveMessage", f);
      });
    }
    const q = query.trim().toLowerCase();
    const items = this.actions.filter(
      a => !q || a.label.toLowerCase().includes(q)
    );
    if (q.length > 1) {
      items.push({
        id: "search-text",
        label: `Search mail for “${query.trim()}”`,
        key: "↩",
        run: () => this.applySearch(query),
      });
    }
    return items;
  },

  _renderPalette() {
    const items = this._paletteItems(this._paletteInput.value);
    this._paletteItemsCache = items;
    this._paletteIndex = 0;
    this._paletteList.textContent = "";
    for (const [i, item] of items.entries()) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.index = i;
      li.dataset.action = item.id;
      const label = document.createElement("span");
      label.className = "palette-label";
      label.textContent = item.label;
      if (item.color) {
        label.style.setProperty("--chip", item.color);
        label.classList.add("palette-tag");
      }
      const key = document.createElement("kbd");
      key.textContent = item.key;
      li.append(label, key);
      li.addEventListener("mousemove", () => this._setPaletteIndex(i));
      li.addEventListener("click", () => this._runPalette(i));
      this._paletteList.appendChild(li);
    }
    this._setPaletteIndex(0);
  },

  _setPaletteIndex(i) {
    const lis = this._paletteList.children;
    if (!lis.length) {
      return;
    }
    this._paletteIndex = (i + lis.length) % lis.length;
    for (const li of lis) {
      li.classList.toggle("selected", li.dataset.index == this._paletteIndex);
    }
    lis[this._paletteIndex].scrollIntoView({ block: "nearest" });
  },

  _runPalette(i) {
    const item = this._paletteItemsCache?.[i];
    this.closePalette();
    item?.run();
  },

  _paletteKey(e) {
    if (e.key == "ArrowDown" || (e.ctrlKey && e.key == "n")) {
      this._setPaletteIndex(this._paletteIndex + 1);
    } else if (e.key == "ArrowUp" || (e.ctrlKey && e.key == "p")) {
      this._setPaletteIndex(this._paletteIndex - 1);
    } else if (e.key == "Enter") {
      this._runPalette(this._paletteIndex);
    } else if (e.key == "Escape") {
      this.closePalette();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  },

  openPalette(prefill = "", mode = "commands") {
    this._paletteMode = mode;
    this._paletteInput.placeholder =
      mode == "search" ? "Search mail…" : "Type a command or search…";
    this._palette.hidden = false;
    this._palette.classList.add("open");
    this._paletteInput.value = prefill;
    this._renderPalette();
    this._paletteInput.focus();
  },

  closePalette() {
    this._palette.classList.remove("open");
    this._palette.hidden = true;
    if (this.reading) {
      document.getElementById("messagePane").focus();
    } else {
      threadTree.table.body.focus();
    }
  },

  get paletteOpen() {
    return !this._palette.hidden;
  },

  /* ----------------------------------------------------------------- keys */

  _typing(event) {
    const t = event.composedTarget ?? event.target;
    if (!t) {
      return false;
    }
    if (t.isContentEditable) {
      return true;
    }
    const name = t.localName;
    return (
      (name == "input" && !["checkbox", "radio", "button"].includes(t.type)) ||
      name == "textarea" ||
      name == "select" ||
      name == "search-bar" ||
      name == "global-search-bar"
    );
  },

  handleEvent(event) {
    switch (event.type) {
      case "keydown":
        this._onKey(event);
        break;
      case "dblclick":
        if (event.target.closest?.("tr")) {
          event.preventDefault();
          event.stopPropagation();
          this.openReading();
        }
        break;
      case "select":
        this.updateCounts();
        break;
    }
  },

  observe(subject, topic, data) {
    if (topic == "superhuman-refresh") {
      this.updateCounts();
    } else if (topic == "superhuman-receipts-updated") {
      threadTree.invalidate();
      const panel = messageBrowser.contentDocument?.getElementById(
        "superhumanSeen"
      );
      if (panel && data.split(",").includes(panel.dataset.rid)) {
        this._renderSeen(panel, SuperhumanReceipts.opensFor(panel.dataset.rid));
      }
    }
  },

  /** Returns true when the key was handled. */
  handleKey(event) {
    const key = event.key;
    // Pressing a modifier on its own (e.g. Shift for "G then #") must not
    // cancel a pending two-key sequence.
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"].includes(key)) {
      return false;
    }
    const lower = key.length == 1 ? key.toLowerCase() : key;
    const { metaKey, ctrlKey, altKey, shiftKey } = event;

    if ((metaKey || ctrlKey) && !altKey && lower == "k" && !shiftKey) {
      this.paletteOpen ? this.closePalette() : this.openPalette();
      return true;
    }
    if (this.paletteOpen || this._typing(event) || altKey) {
      return false;
    }

    // Control: account switching and copy link.
    if (ctrlKey && !metaKey) {
      if (/^[1-9]$/.test(key)) {
        this.switchAccount(Number(key) - 1);
        return true;
      }
      if (key == "/") {
        this.copyLink();
        return true;
      }
      return false;
    }

    // Command combinations.
    if (metaKey) {
      if (shiftKey) {
        if (lower == "a") {
          threadTree.selectAll();
          return true;
        }
        if (lower == "f") {
          this.toggleFolders();
          return true;
        }
        return false;
      }
      const map = {
        a: () => this.selectFromHere(),
        u: () => this.unsubscribe(),
        o: () => this.openLinks(),
        n: () => this.newWindow(),
        ",": () => top.openPreferencesTab(),
        ArrowUp: () => this.jump(false),
        ArrowDown: () => this.jump(true),
        "=": () => this.textSize(1),
        "+": () => this.textSize(1),
        "-": () => this.textSize(-1),
        0: () => this.textSize(0),
      };
      const fn = map[lower] ?? map[key];
      if (fn) {
        fn();
        return true;
      }
      return false;
    }

    // Two-key "G then X" jumps.
    if (this._gPending) {
      clearTimeout(this._gPending);
      this._gPending = null;
      const map = {
        i: () => this.goSplit("important"),
        o: () => this.goSplit("other"),
        s: () => this.goStarred(),
        d: () => this.go("Drafts"),
        t: () => this.go("SentMail"),
        e: () => this.go("Archive"),
        h: () => this.goStarred(),
        m: () => this.goMuted(),
        ";": () => this.go("Templates"),
        "!": () => this.go("Junk"),
        1: () => this.go("Junk"),
        "#": () => this.go("Trash"),
        3: () => this.go("Trash"),
        a: () => this.goAll(),
        l: () => this.openPalette("golabel:"),
      };
      const fn = map[lower] ?? map[key];
      if (fn) {
        fn();
        return true;
      }
    }

    if (shiftKey) {
      const map = {
        J: () => this.extendSelection(1),
        K: () => this.extendSelection(-1),
        ArrowDown: () => this.extendSelection(1),
        ArrowUp: () => this.extendSelection(-1),
        E: () => this.notDone(),
        M: () => this.mute(),
        O: () => commandController.doCommand("cmd_expandAllThreads"),
        Y: () => commandController.doCommand("cmd_removeTags"),
        U: () => this.toggleFilter("unread"),
        S: () => this.toggleFilter("starred"),
        I: () => this.selectSplit("important"),
        R: () => this.toggleNoReply(),
        " ": () => this.scrollMessage(-1),
        "#": () => this.trash(),
        "!": () => this.spam(),
        "?": () => this.openPalette(),
        Tab: () => (this.reading ? this.cycleLinks(-1) : this.cycleSplit(-1)),
      };
      const fn = map[key];
      if (fn) {
        fn();
        return true;
      }
      return false;
    }

    switch (key) {
      case "g":
        this._gPending = setTimeout(() => (this._gPending = null), 1500);
        return true;
      case "j":
      case "ArrowDown":
        this.move(1);
        return true;
      case "k":
      case "ArrowUp":
        this.move(-1);
        return true;
      case "n":
        this.stepMessage(1);
        return true;
      case "p":
        this.stepMessage(-1);
        return true;
      case "Enter":
        if (!this.reading) {
          this.openReading();
        } else {
          this.reply(true);
        }
        return true;
      case "Escape":
        if (this.clearSelection()) {
          return true;
        }
        if (this.searchText && !this.reading) {
          this.applySearch("");
          return true;
        }
        if (this.reading) {
          this.closeReading();
          return true;
        }
        return false;
      case "ArrowLeft":
        if (this.reading) {
          return false;
        }
        this.toggleFolders();
        return true;
      case " ":
        this.scrollMessage(1);
        return true;
      case "e":
        this.done();
        return true;
      case "#":
        this.trash();
        return true;
      case "!":
        this.spam();
        return true;
      case "s":
        commandController.doCommand("cmd_markAsFlagged");
        return true;
      case "u":
        this.toggleRead();
        return true;
      case "r":
        this.reply(false);
        return true;
      case "f":
        this._selectNewest();
        commandController.doCommand("cmd_forwardInline");
        return true;
      case "c":
        commandController.doCommand("cmd_newMessage");
        return true;
      case "h":
        this.remind();
        return true;
      case "l":
        this.openPalette("label:");
        return true;
      case "y":
        this.removeSplitLabel(0);
        return true;
      case "[":
        this.removeSplitLabel(1);
        return true;
      case "]":
        this.removeSplitLabel(-1);
        return true;
      case "v":
        this.openPalette("move:");
        return true;
      case "x":
        this.toggleSelect();
        return true;
      case "o":
        this.toggleThread();
        return true;
      case "z":
        this.undo();
        return true;
      case "/":
        this.focusSearch();
        return true;
      case "?":
        this.openPalette();
        return true;
      case "Tab":
        if (this.reading) {
          this.cycleLinks(1);
        } else {
          this.cycleSplit(1);
        }
        return true;
    }
    return false;
  },

  _onKey(event) {
    if (event.defaultPrevented || !this.enabled) {
      return;
    }
    if (this.handleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  },
};
