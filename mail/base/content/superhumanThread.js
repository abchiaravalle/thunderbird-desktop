/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Superhuman-style conversation view inside about:message.
 *
 * Above the newest message: one line per earlier message in the thread
 * ("Maria   Thanks for sending that over…"), click to open that one.
 * The newest message gets a quiet "↩  Me to Colleen ✓" line instead of the
 * Thunderbird header. Below it: an inline reply box with plain "Send ·
 * Send later · Remind me" text actions. Gated on mail.superhuman.enabled.
 */

/* globals gMessage, gMessageURI, gViewWrapper, MailServices,
   getMessagePaneBrowser */

"use strict";

var superhumanThread = {
  get enabled() {
    return Services.prefs.getBoolPref("mail.superhuman.enabled", false);
  },

  _me() {
    try {
      return new Set(
        MailServices.accounts.allIdentities.map(i => i.email.toLowerCase())
      );
    } catch {
      return new Set();
    }
  },

  _person(header) {
    const [addr] = MailServices.headerParser.parseEncodedHeaderW(header || "");
    if (!addr) {
      return { name: "", email: "" };
    }
    return { name: addr.name || addr.email.split("@")[0], email: addr.email };
  },

  _first(name) {
    return (name || "").split(/\s+/)[0];
  },

  /** Earlier messages in the same thread, oldest first. */
  _earlier(hdr) {
    const out = [];
    try {
      const db = hdr.folder.msgDatabase;
      const thread = db.getThreadContainingMsgHdr(hdr);
      for (let i = 0; i < thread.numChildren; i++) {
        const child = thread.getChildHdrAt(i);
        if (child && child.messageKey != hdr.messageKey && child.date <= hdr.date) {
          out.push(child);
        }
      }
    } catch (e) {
      console.error(e);
    }
    return out.sort((a, b) => a.date - b.date);
  },

  onLoaded(hdr) {
    const doc = document;
    doc.getElementById("superhumanThread")?.remove();
    doc.getElementById("superhumanReply")?.remove();
    const browser = getMessagePaneBrowser();
    browser.style.removeProperty("flex");
    browser.style.removeProperty("height");
    doc.documentElement.classList.toggle("superhuman", this.enabled);
    if (!this.enabled || !hdr) {
      return;
    }
    const me = this._me();
    const from = this._person(hdr.mime2DecodedAuthor || hdr.author);
    const fromMe = me.has(from.email.toLowerCase());
    const to = MailServices.headerParser
      .parseEncodedHeaderW(hdr.mime2DecodedRecipients || hdr.recipients || "")
      .map(a => (me.has(a.email.toLowerCase()) ? "Me" : this._first(a.name || a.email)));
    const toText =
      to.length > 3 ? `${to.slice(0, 3).join(", ")}, and ${to.length - 3} more` : to.join(", ");

    const wrap = doc.createElement("div");
    wrap.id = "superhumanThread";

    for (const prior of this._earlier(hdr)) {
      const p = this._person(prior.mime2DecodedAuthor || prior.author);
      const row = doc.createElement("div");
      row.className = "sh-collapsed";
      row.tabIndex = -1;
      const name = doc.createElement("span");
      name.className = "sh-collapsed-name";
      name.textContent = me.has(p.email.toLowerCase()) ? "Me" : this._first(p.name);
      const snip = doc.createElement("span");
      snip.className = "sh-collapsed-snippet";
      const clean = t => (t || "").replace(/\s+/g, " ").trim();
      snip.textContent = clean(prior.getStringProperty("preview"));
      row.append(name, snip);
      row.addEventListener("click", () => {
        try {
          parent.selectMessage?.(prior);
        } catch (e) {
          console.error(e);
        }
      });
      wrap.appendChild(row);
      if (!snip.textContent) {
        const fill = () =>
          (snip.textContent =
            clean(prior.getStringProperty("preview")) ||
            clean(prior.mime2DecodedSubject));
        try {
          const async = prior.folder.fetchMsgPreviewText([prior.messageKey], {
            OnStartRunningUrl() {},
            OnStopRunningUrl: fill,
          });
          if (!async) {
            fill();
          }
        } catch {
          fill();
        }
      }
    }

    const line = doc.createElement("div");
    line.className = "sh-fromline";
    const arrow = doc.createElement("span");
    arrow.className = "sh-fromline-arrow";
    arrow.textContent = "↩";
    const who = doc.createElement("span");
    who.className = "sh-fromline-who";
    who.textContent = `${fromMe ? "Me" : from.name} to ${toText || "Me"}`;
    who.title = from.email;
    const when = doc.createElement("span");
    when.className = "sh-fromline-when";
    when.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(hdr.date / 1000));
    line.append(arrow, who, when);
    wrap.appendChild(line);

    const header = doc.getElementById("messageHeader");
    const box = doc.getElementById("singleMessage");
    box.parentNode.insertBefore(wrap, box);
    header.dataset.superhuman = "1";

    const sender = fromMe ? toText : this._first(from.name);
    const everyone = [fromMe ? null : this._first(from.name), ...to.filter(n => n != "Me")]
      .filter(Boolean)
      .join(", ");
    this._buildReply(hdr, sender);
    const reply = doc.getElementById("superhumanReply");
    reply.dataset.uri = gMessageURI;
    reply.dataset.sender = sender || "everyone";
    reply.dataset.everyone = everyone || sender || "everyone";
    reply.dataset.all = "";
  },

  _buildReply(hdr, toName) {
    const doc = document;
    const reply = doc.createElement("div");
    reply.id = "superhumanReply";
    const card = doc.createElement("div");
    card.className = "sh-reply-card";
    const label = doc.createElement("div");
    label.className = "sh-reply-label";
    const kind = doc.createElement("span");
    kind.className = "sh-reply-kind";
    kind.textContent = "Reply";
    const target = doc.createElement("span");
    target.className = "sh-reply-target";
    target.textContent = ` to ${toName || "everyone"}`;
    label.append(kind, target);
    const text = doc.createElement("textarea");
    text.className = "sh-reply-text";
    text.rows = 3;
    text.placeholder = "Write a reply";
    const actions = doc.createElement("div");
    actions.className = "sh-reply-actions";
    for (const [name, mode] of [
      ["Send", "now"],
      ["Send later", "later"],
      ["Remind me", "remind"],
    ]) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "sh-reply-action";
      button.textContent = name;
      button.addEventListener("click", () => this.send(hdr, text, mode));
      actions.appendChild(button);
    }
    text.addEventListener("keydown", event => {
      if (event.key == "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.send(hdr, text, "now");
      } else if (event.key == "Escape") {
        text.blur();
      }
      event.stopPropagation();
    });
    card.append(label, text, actions);
    reply.appendChild(card);
    const box = getMessagePaneBrowser();
    box.parentNode.insertBefore(reply, box.nextSibling);
    this._fitBody();
  },

  /**
   * Superhuman puts the reply right under the message, not at the bottom of
   * the window: size the message browser to its content and let the whole
   * conversation scroll together.
   */
  _fitBody() {
    const browser = getMessagePaneBrowser();
    const fit = () => {
      try {
        const doc = browser.contentDocument;
        if (!doc?.body) {
          return;
        }
        // Measure the content itself; documentElement.scrollHeight is at least
        // the browser's own height, which would never let it shrink.
        const body = doc.body;
        const style = doc.defaultView.getComputedStyle(body);
        const h =
          body.getBoundingClientRect().height +
          parseFloat(style.marginTop || 0) +
          parseFloat(style.marginBottom || 0);
        browser.style.flex = "0 0 auto";
        browser.style.height = Math.max(60, Math.ceil(h) + 8) + "px";
      } catch {}
    };
    fit();
    for (const delay of [100, 400, 1200]) {
      setTimeout(fit, delay);
    }
    try {
      browser.contentWindow?.addEventListener("load", fit, { once: true });
    } catch {}
  },

  /** @param {boolean} all - Reply all (Enter) or just the sender (R). */
  focusReply(all = true) {
    const reply = document.getElementById("superhumanReply");
    const text = reply?.querySelector(".sh-reply-text");
    if (!text || reply.dataset.uri != gMessageURI) {
      return false;
    }
    reply.dataset.all = all ? "1" : "";
    reply.querySelector(".sh-reply-kind").textContent = all ? "Reply all" : "Reply";
    reply.querySelector(".sh-reply-target").textContent = ` to ${
      all ? reply.dataset.everyone : reply.dataset.sender
    }`;
    text.focus();
    return true;
  },

  /**
   * Send the inline reply: opens Thunderbird's compose (reply all) with the
   * typed text so quoting, identity, signature and receipts all apply, and
   * sends it straight away ("now"), queues it ("later") or just stars the
   * conversation ("remind").
   */
  send(hdr, textArea, mode) {
    const body = textArea.value.trim();
    if (mode == "remind") {
      hdr.folder.markMessagesFlagged([hdr], true);
      parent.superhuman?.toast("Reminder set: if no reply, it stays starred", true);
      return;
    }
    if (!body) {
      textArea.focus();
      return;
    }
    const params = Cc[
      "@mozilla.org/messengercompose/composeparams;1"
    ].createInstance(Ci.nsIMsgComposeParams);
    const all = !!document.getElementById("superhumanReply")?.dataset.all;
    params.type = all ? Ci.nsIMsgCompType.ReplyAll : Ci.nsIMsgCompType.Reply;
    params.format = Ci.nsIMsgCompFormat.Default;
    params.originalMsgURI = hdr.folder.getUriForMsg(hdr);
    params.origMsgHdr = hdr;
    try {
      params.identity = MailServices.accounts.getFirstIdentityForServer(
        hdr.folder.server
      );
    } catch {}
    const fields = Cc[
      "@mozilla.org/messengercompose/composefields;1"
    ].createInstance(Ci.nsIMsgCompFields);
    fields.body = body
      .split(/\n{2,}/)
      .map(p => `<p>${p.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/\n/g, "<br>")}</p>`)
      .join("");
    params.composeFields = fields;
    const opener = win => {
      if (!win.location.href.includes("messengercompose")) {
        return;
      }
      Services.ww.unregisterNotification(watcher);
      let sent = false;
      const go = () => {
        if (sent) {
          return;
        }
        sent = true;
        win.goDoCommand(mode == "later" ? "cmd_sendLater" : "cmd_sendNow");
      };
      win.addEventListener("compose-editor-ready", () => setTimeout(go, 50), {
        once: true,
      });
      // In case the editor was ready before we started listening.
      const poll = win.setInterval(() => {
        if (win.composeEditorReady || win.gMsgCompose?.editor) {
          win.clearInterval(poll);
          setTimeout(go, 300);
        }
      }, 200);
      win.setTimeout(() => win.clearInterval(poll), 15000);
    };
    const watcher = {
      observe(subject, topic) {
        if (topic == "domwindowopened") {
          subject.addEventListener("load", () => opener(subject), { once: true });
        }
      },
    };
    Services.ww.registerNotification(watcher);
    setTimeout(() => Services.ww.unregisterNotification(watcher), 15000);
    MailServices.compose.OpenComposeWindowWithParams(null, params);
    textArea.value = "";
    parent.superhuman?.toast(mode == "later" ? "Queued to send later" : "Sending…", false);
  },
};

window.addEventListener("MsgLoaded", event => superhumanThread.onLoaded(event.detail));
