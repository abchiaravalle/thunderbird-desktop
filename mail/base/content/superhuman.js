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
 * - Single-line rows: sender column, label chips, subject + grey preview, time.
 * - Full-width reading: Enter opens the selected conversation in place of the
 *   list, Escape goes back.
 * - Superhuman's keyboard map (E, J/K, #, !, S, U, C, R, F, Z, /, H, G+key).
 * - Command palette on Cmd+K (or Ctrl+K) listing every action and its key.
 */

/* globals gFolder, gDBView, gViewWrapper, threadTree, threadPane, paneLayout,
   quickFilterBar, commandController, displayFolder, goDoCommand,
   MailServices */

"use strict";

var superhuman = {
  PREF: "mail.superhuman.enabled",
  get enabled() {
    return Services.prefs.getBoolPref(this.PREF, false);
  },

  /** Split inbox definitions: label, and how to filter. */
  SPLITS: [
    { id: "important", label: "Important", tags: { $label1: true } },
    { id: "team", label: "Team", tags: { $label2: true } },
    { id: "personal", label: "Personal", tags: { $label3: true } },
    { id: "travel", label: "Travel", tags: { $label4: true } },
    { id: "todo", label: "To Do", tags: { $label5: true } },
    { id: "other", label: "Other", mode: "NONE" },
  ],

  activeSplit: "important",
  reading: false,
  _gPending: null,
  _undo: null,

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
  },

  /* ---------------------------------------------------------------- splits */

  _buildSplitBar() {
    const bar = document.createElement("nav");
    bar.id = "superhumanSplits";
    bar.setAttribute("role", "tablist");

    const menu = document.createElement("button");
    menu.id = "superhumanMenuButton";
    menu.className = "superhuman-menu";
    menu.title = "Folders";
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
    return !!(
      gFolder && gFolder.getFlag(Ci.nsMsgFolderFlags.Inbox)
    );
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
      threadTree.table.body.focus();
      if (gDBView?.rowCount && threadTree.selectedIndex < 0) {
        threadTree.selectedIndex = 0;
      }
    }
  },

  cycleSplit(delta) {
    const i = this.SPLITS.findIndex(s => s.id == this.activeSplit);
    const n = this.SPLITS.length;
    this.selectSplit(this.SPLITS[(i + delta + n) % n].id);
  },

  /** Called when the displayed folder changes. */
  onFolderChanged() {
    if (!this.enabled || !this._splitBar) {
      return;
    }
    this._splitBar.hidden = !this._isInbox();
    if (this._isInbox()) {
      this.selectSplit(this.activeSplit, { focusList: false });
    }
    this.updateCounts();
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
    let hdr;
    try {
      hdr = gDBView.getMsgHdrAt(index);
    } catch {
      return null;
    }
    const d = new Date(hdr.date / 1000);
    const now = new Date();
    if (d.toDateString() == now.toDateString()) {
      return this._fmtTime.format(d);
    }
    return d.getFullYear() == now.getFullYear()
      ? this._fmtDay.format(d)
      : this._fmtYear.format(d);
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

  /* --------------------------------------------------------------- reading */

  openReading() {
    if (!gDBView || threadTree.selectedIndex < 0) {
      return;
    }
    this.reading = true;
    document.body.classList.add("superhuman-reading");
    paneLayout.messagePaneSplitter.isCollapsed = false;
    document.getElementById("messagePane").focus();
  },

  closeReading() {
    this.reading = false;
    document.body.classList.remove("superhuman-reading");
    threadTree.table.body.focus();
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

  focusSearch() {
    const bar = top.document.querySelector(
      "#unifiedToolbarContent .search-bar global-search-bar"
    );
    if (bar) {
      bar.focus();
    } else {
      this.openPalette();
    }
  },

  /* -------------------------------------------------------------- actions */

  /** Every action: id, label, key hint, function. Used by keys + palette. */
  get actions() {
    const cmd = c => () => commandController.doCommand(c);
    return [
      { id: "done", label: "Mark done (archive)", key: "E", run: () => this.done() },
      { id: "trash", label: "Trash", key: "#", run: () => this.trash() },
      { id: "spam", label: "Mark as spam", key: "!", run: cmd("cmd_markAsJunk") },
      { id: "star", label: "Star / unstar", key: "S", run: cmd("cmd_markAsFlagged") },
      { id: "unread", label: "Mark read / unread", key: "U", run: () => this.toggleRead() },
      { id: "reply", label: "Reply", key: "R", run: cmd("cmd_replySender") },
      { id: "replyall", label: "Reply all", key: "⇧R", run: cmd("cmd_replyall") },
      { id: "forward", label: "Forward", key: "F", run: cmd("cmd_forwardInline") },
      { id: "compose", label: "Compose", key: "C", run: cmd("cmd_newMessage") },
      { id: "remind", label: "Remind me (mark for follow-up)", key: "H", run: () => this.remind() },
      { id: "label", label: "Add label", key: "L", run: () => this.openPalette("label:") },
      { id: "removelabels", label: "Remove all labels", key: "⇧Y", run: cmd("cmd_removeTags") },
      { id: "undo", label: "Undo", key: "Z", run: () => this.undo() },
      { id: "next", label: "Next conversation", key: "J", run: () => this.move(1) },
      { id: "prev", label: "Previous conversation", key: "K", run: () => this.move(-1) },
      { id: "open", label: "Open conversation", key: "↩", run: () => this.openReading() },
      { id: "back", label: "Back to list", key: "Esc", run: () => this.closeReading() },
      { id: "search", label: "Search", key: "/", run: () => this.focusSearch() },
      { id: "nextsplit", label: "Next split", key: "Tab", run: () => this.cycleSplit(1) },
      { id: "prevsplit", label: "Previous split", key: "⇧Tab", run: () => this.cycleSplit(-1) },
      { id: "folders", label: "Show / hide folders", key: "⌘⇧F", run: () => this.toggleFolders() },
      { id: "selectall", label: "Select all", key: "⌘A", run: cmd("cmd_selectAll") },
      { id: "goinbox", label: "Go to Inbox", key: "G I", run: () => this.go("Inbox") },
      { id: "gostarred", label: "Go to Starred", key: "G S", run: () => this.goStarred() },
      { id: "godrafts", label: "Go to Drafts", key: "G D", run: () => this.go("Drafts") },
      { id: "gosent", label: "Go to Sent", key: "G T", run: () => this.go("SentMail") },
      { id: "godone", label: "Go to Done (Archive)", key: "G E", run: () => this.go("Archive") },
      { id: "gospam", label: "Go to Spam", key: "G !", run: () => this.go("Junk") },
      { id: "gotrash", label: "Go to Trash", key: "G #", run: () => this.go("Trash") },
      ...this.SPLITS.map((s, i) => ({
        id: "split-" + s.id,
        label: "Split: " + s.label,
        key: i < 9 ? `⌃${i + 1}` : "",
        run: () => this.selectSplit(s.id),
      })),
    ];
  },

  _selectedHdrs() {
    return gDBView ? gDBView.getSelectedMsgHdrs() : [];
  },

  done() {
    const hdrs = this._selectedHdrs();
    if (!hdrs.length) {
      return;
    }
    this._remember(hdrs, "Marked done");
    commandController.doCommand("cmd_archive");
  },

  trash() {
    const hdrs = this._selectedHdrs();
    if (!hdrs.length) {
      return;
    }
    this._remember(hdrs, "Moved to Trash");
    commandController.doCommand("cmd_delete");
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

  _remember(hdrs, message) {
    this._undo = { message };
    this.toast(message, true);
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
    threadTree.selectedIndex = next;
    threadTree.scrollToIndex(next);
  },

  go(kind) {
    const flags = {
      Inbox: Ci.nsMsgFolderFlags.Inbox,
      Drafts: Ci.nsMsgFolderFlags.Drafts,
      SentMail: Ci.nsMsgFolderFlags.SentMail,
      Archive: Ci.nsMsgFolderFlags.Archive,
      Junk: Ci.nsMsgFolderFlags.Junk,
      Trash: Ci.nsMsgFolderFlags.Trash,
    };
    const server = gFolder?.server;
    let folder =
      server?.rootFolder.getFolderWithFlags(flags[kind]) ??
      MailServices.accounts.localFoldersServer.rootFolder.getFolderWithFlags(
        flags[kind]
      );
    if (!folder) {
      folder = MailServices.accounts.allFolders.find(f =>
        f.getFlag(flags[kind])
      );
    }
    if (folder) {
      if (this.reading) {
        this.closeReading();
      }
      displayFolder(folder.URI);
      threadTree.table.body.focus();
    } else {
      this.toast(`No ${kind} folder`);
    }
  },

  goStarred() {
    if (!this._isInbox()) {
      this.go("Inbox");
    }
    quickFilterBar.filterer.setFilterValue("starred", true);
    quickFilterBar.updateSearch();
    this.toast("Showing starred");
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

  _paletteItems(query) {
    if (query.startsWith("label:")) {
      const q = query.slice(6).trim().toLowerCase();
      return MailServices.tags
        .getAllTags()
        .filter(t => !q || t.tag.toLowerCase().includes(q))
        .map(t => ({
          id: "tag-" + t.key,
          label: "Label: " + t.tag,
          key: "",
          color: t.color,
          run: () => {
            const event = { target: { value: t.key } };
            commandController.doCommand("cmd_toggleTag", event);
            this.toast(`Labeled ${t.tag}`);
          },
        }));
    }
    const q = query.trim().toLowerCase();
    const items = this.actions.filter(a => !q || a.label.toLowerCase().includes(q));
    if (q.length > 1) {
      items.push({
        id: "search-text",
        label: `Search mail for “${query.trim()}”`,
        key: "↩",
        run: () => {
          quickFilterBar.filterer.setFilterValue("text", {
            text: query.trim(),
            states: { recipients: true, sender: true, subject: true, body: false },
          });
          quickFilterBar.updateSearch();
        },
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

  openPalette(prefill = "") {
    this._palette.hidden = false;
    this._palette.classList.add("open");
    this._paletteInput.value = prefill;
    this._renderPalette();
    this._paletteInput.focus();
  },

  closePalette() {
    this._palette.classList.remove("open");
    this._palette.hidden = true;
    (this.reading
      ? document.getElementById("messagePane")
      : threadTree.table.body
    ).focus();
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
      name == "search-bar"
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

  observe(subject, topic) {
    if (topic == "superhuman-refresh") {
      this.updateCounts();
    }
  },

  /** Returns true when the key was handled. */
  handleKey(event) {
    const accel = event.metaKey || event.ctrlKey;
    if (accel && !event.altKey && event.key.toLowerCase() == "k") {
      this.paletteOpen ? this.closePalette() : this.openPalette();
      return true;
    }
    if (accel && event.shiftKey && event.key.toLowerCase() == "f") {
      this.toggleFolders();
      return true;
    }
    if (event.ctrlKey && !event.metaKey && /^[1-9]$/.test(event.key)) {
      const split = this.SPLITS[Number(event.key) - 1];
      if (split) {
        this.selectSplit(split.id);
        return true;
      }
    }
    if (this.paletteOpen || this._typing(event)) {
      return false;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }

    // Two-key "G then X" jumps.
    if (this._gPending) {
      clearTimeout(this._gPending);
      this._gPending = null;
      const map = {
        i: () => this.go("Inbox"),
        s: () => this.goStarred(),
        d: () => this.go("Drafts"),
        t: () => this.go("SentMail"),
        e: () => this.go("Archive"),
        "!": () => this.go("Junk"),
        "#": () => this.go("Trash"),
      };
      const fn = map[event.key.toLowerCase()] ?? map[event.key];
      if (fn) {
        fn();
        return true;
      }
    }

    switch (event.key) {
      case "g":
        this._gPending = setTimeout(() => (this._gPending = null), 1200);
        return true;
      case "j":
        this.move(1);
        return true;
      case "k":
        this.move(-1);
        return true;
      case "Enter":
        if (!this.reading) {
          this.openReading();
          return true;
        }
        commandController.doCommand("cmd_replyall");
        return true;
      case "Escape":
        if (this.reading) {
          this.closeReading();
          return true;
        }
        return false;
      case "e":
        this.done();
        return true;
      case "#":
        this.trash();
        return true;
      case "!":
        commandController.doCommand("cmd_markAsJunk");
        return true;
      case "s":
        commandController.doCommand("cmd_markAsFlagged");
        return true;
      case "u":
        this.toggleRead();
        return true;
      case "r":
        commandController.doCommand("cmd_replySender");
        return true;
      case "R":
        commandController.doCommand("cmd_replyall");
        return true;
      case "f":
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
      case "Y":
        commandController.doCommand("cmd_removeTags");
        return true;
      case "z":
        this.undo();
        return true;
      case "/":
        this.focusSearch();
        return true;
      case "Tab":
        if (!this.reading) {
          this.cycleSplit(event.shiftKey ? -1 : 1);
          return true;
        }
        return false;
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
