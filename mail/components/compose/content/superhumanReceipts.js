/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Superhuman-style read receipts for the compose window.
 *
 * On send (not on draft save), when mail.superhuman.receipts.enabled is on
 * and the message is HTML (Auto format is sent as HTML + plain text), a random id is minted, a 1x1 image pointing at
 * mail.superhuman.receipts.host is appended to the body, and the id is sent
 * as the X-Superhuman-Receipt header so the Sent copy can be matched back to
 * its opens. The service only ever sees that random id.
 */

/* globals gMsgCompose, GetCurrentEditor */

"use strict";

var superhumanReceipts = {
  get enabled() {
    return (
      Services.prefs.getBoolPref("mail.superhuman.enabled", false) &&
      Services.prefs.getBoolPref("mail.superhuman.receipts.enabled", false)
    );
  },

  get host() {
    return Services.prefs.getCharPref(
      "mail.superhuman.receipts.host",
      "r.amplifi.studio"
    );
  },

  newId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  },

  /**
   * Runs at "compose-prepare-message-start", before Thunderbird decides
   * whether the message can go out as plain text, so the pixel keeps it HTML.
   */
  onSend(event) {
    const mode = event.detail.msgType;
    const isSend =
      mode == Ci.nsIMsgCompDeliverMode.Now ||
      mode == Ci.nsIMsgCompDeliverMode.Later ||
      mode == Ci.nsIMsgCompDeliverMode.Background;
    if (!isSend || !this.enabled || !gMsgCompose?.composeHTML) {
      return;
    }
    const format = gMsgCompose.compFields.deliveryFormat;
    if (
      format == Ci.nsIMsgCompSendFormat.PlainText ||
      format == Ci.nsIMsgCompSendFormat.Unset ||
      format == Ci.nsIMsgCompSendFormat.Auto
    ) {
      if (format == Ci.nsIMsgCompSendFormat.PlainText) {
        // The user chose plain text on purpose: no pixel.
        return;
      }
      // Auto would downgrade simple mail to plain text and drop the pixel.
      // Send HTML with a plain-text part, like Superhuman.
      gMsgCompose.compFields.deliveryFormat = Ci.nsIMsgCompSendFormat.Both;
    }
    const fields = gMsgCompose.compFields;
    if (fields.hasHeader("X-Superhuman-Receipt")) {
      return;
    }
    try {
      const doc = document.getElementById("messageEditor").contentDocument;
      doc.querySelectorAll("img[data-sh-receipt]").forEach(el => el.remove());
      const id = this.newId();
      const img = doc.createElement("img");
      img.setAttribute("src", `https://${this.host}/p/${id}.gif`);
      img.setAttribute("width", "1");
      img.setAttribute("height", "1");
      img.setAttribute("alt", "");
      img.setAttribute("data-sh-receipt", "1");
      img.setAttribute(
        "style",
        "display:block;width:1px;height:1px;border:0;opacity:0;overflow:hidden"
      );
      doc.body.appendChild(img);
      fields.setUnstructuredHeader("X-Superhuman-Receipt", id);
    } catch (e) {
      console.error("read receipt not added", e);
    }
  },
};

window.addEventListener(
  "compose-prepare-message-start",
  event => superhumanReceipts.onSend(event),
  true
);
