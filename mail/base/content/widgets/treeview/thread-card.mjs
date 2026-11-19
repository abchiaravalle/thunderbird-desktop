/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

import { TreeViewTableRow } from "chrome://messenger/content/tree-view.mjs";
// eslint-disable-next-line import-x/no-unassigned-import
import "chrome://messenger/content/thread-card-tags.mjs";

const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

/**
 * The tr element row of the TreeView table for the cards view layout.
 * NOTE: The main child is a clone of the `#threadPaneCardTemplate` template.
 *
 * @tagname thread-row
 * @augments {TreeViewTableRow}
 */
class ThreadCard extends TreeViewTableRow {
  static ROW_HEIGHT = 46;

  connectedCallback() {
    if (this.hasConnected) {
      return;
    }

    super.connectedCallback();

    this.setAttribute("draggable", "true");
    this.classList.add("card-layout");

    this.appendChild(
      document.getElementById("threadPaneCardTemplate").content.cloneNode(true)
    );

    this.cardCell = this.querySelector("td");
    this.accountIndicator = this.querySelector(".account-indicator");
    this.senderLine = this.querySelector(".sender");
    this.subjectLine = this.querySelector(".subject");
    this.dateLine = this.querySelector(".date");
    this.starButton = this.querySelector(".button-star");
    this.threadCardTags = this.querySelector("thread-card-tags");
    this.replies = this.querySelector(".thread-replies");
    this.twistyButton = this.querySelector("button.twisty");
    this.sortHeaderDetails = this.querySelector(".sort-header-details");
    this.statusIndicator = this.querySelector(".read-status");
    this.chips = this.querySelector(".superhuman-chips");
    this.previewLine = this.querySelector(".superhuman-preview");
    this.receiptLine = this.querySelector(".superhuman-receipt");
  }

  /**
   * Superhuman layout: fill the label chips and the grey preview text that
   * follows the subject. No-op unless mail.superhuman.enabled is set.
   *
   * @param {string} tagKeys - Space separated tag keys of the message.
   * @param {boolean} isDummy - Whether this is a group header row.
   */
  #fillSuperhuman(tagKeys, isDummy) {
    if (!this.chips || !window.superhuman?.enabled) {
      return;
    }
    this.chips.replaceChildren();
    this.previewLine.textContent = "";
    this.receiptLine.hidden = true;
    this.receiptLine.removeAttribute("data-state");
    this.receiptLine.textContent = "";
    if (isDummy) {
      return;
    }
    const receipt = window.superhuman.receiptFor(this._index);
    if (receipt) {
      const count = receipt.opens?.length;
      this.receiptLine.hidden = false;
      this.receiptLine.dataset.state =
        count == null ? "pending" : count ? "opened" : "unopened";
      this.receiptLine.textContent = count ? `Seen ${count}` : "";
      this.receiptLine.title =
        count == null
          ? "Read receipt: checking"
          : count
            ? `Opened ${count} time${count == 1 ? "" : "s"}`
            : "Not opened yet";
    }
    for (const key of (tagKeys || "").split(" ").filter(Boolean)) {
      const info = window.superhuman.chipFor(key);
      if (!info) {
        continue;
      }
      const chip = document.createElement("span");
      chip.className = "superhuman-chip";
      chip.textContent = info.text;
      chip.style.setProperty("--chip", info.color);
      this.chips.appendChild(chip);
    }
    this.previewLine.textContent = window.superhuman.previewFor(this._index);
    const date = window.superhuman.dateFor(this._index);
    if (date) {
      this.dateLine.textContent = date;
    }
    // Superhuman shows just the person's name: "Ann Lee <ann@x.com>" -> "Ann Lee".
    const name = this.senderLine.textContent.replace(/\s*<[^>]+>\s*$/, "");
    if (name && name != this.senderLine.textContent) {
      this.senderLine.textContent = name;
    }
  }

  fillRow() {
    super.fillRow();

    if (this.getAttribute("role") == "row") {
      this.cardCell.setAttribute("role", "gridcell");
    }

    // XPCOM calls here must be keep to a minimum. Collect all of the
    // required data in one go.
    const properties = {};
    const threadLevel = {};

    const cellTexts = this.view.cellDataForColumns(
      this._index,
      window.threadPane.cardColumns,
      properties,
      threadLevel
    );

    // Collect the various strings and fluent IDs to build the full string for
    // the message row aria-label.
    const ariaLabelPromises = [];
    // Use static mapping instead of threadPane.cardColumns since the name of
    // the sender column changes. (see getProperSenderForCardsView)
    const KEYS = [
      "subject",
      "sender",
      "date",
      "tagKeys",
      "total",
      "unread",
      "account",
      "serverKey",
    ];
    const data = Object.fromEntries(KEYS.map((key, i) => [key, cellTexts[i]]));

    this.accountIndicator.style.setProperty(
      "--account-color",
      `var(--server-${CSS.escape(data.serverKey)}-color)`
    );
    this.accountIndicator.title = data.account;

    if (threadLevel.value) {
      properties.value += " thread-children";
    }
    const propertiesSet = new Set(properties.value.split(" "));
    this.dataset.properties = properties.value.trim();
    this.#updateTwistyButton();

    this.subjectLine.textContent = data.subject;
    this.subjectLine.title = data.subject;
    // Clear reused Superhuman bits; filled again below for message rows.
    this.#fillSuperhuman("", true);

    // Handle a different style and data if this is a dummy row.
    if (propertiesSet.has("dummy")) {
      const unread = Number(data.unread);
      const total = Number(data.total);

      if (unread) {
        document.l10n.setAttributes(
          this.sortHeaderDetails,
          "threadpane-sort-header-unread-count",
          {
            unread,
            total,
          }
        );
        return;
      }

      document.l10n.setAttributes(
        this.sortHeaderDetails,
        "threadpane-sort-header-count",
        {
          total,
        }
      );
      return;
    }

    this.senderLine.textContent = data.sender;
    this.senderLine.title = data.sender;
    this.dateLine.textContent = data.date;

    this.threadCardTags.setAttribute("tags", data.tagKeys);
    this.#fillSuperhuman(data.tagKeys, false);
    // Superhuman shows a conversation's size as a small grey number.
    const total = parseInt(data.total);
    this.senderLine.dataset.count = total > 1 ? String(total) : "";

    // Follow the layout order.
    ariaLabelPromises.push(data.sender);
    ariaLabelPromises.push(data.date);
    ariaLabelPromises.push(data.subject);
    ariaLabelPromises.push(data.tags);

    if (propertiesSet.has("flagged")) {
      document.l10n.setAttributes(
        this.starButton,
        "tree-list-view-row-flagged"
      );
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-flagged-cell-label")
      );
    } else {
      document.l10n.setAttributes(this.starButton, "tree-list-view-row-flag");
    }

    if (propertiesSet.has("junk")) {
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-spam-cell-label")
      );
    }

    if (propertiesSet.has("new")) {
      document.l10n.setAttributes(
        this.statusIndicator,
        "tree-list-view-row-new-status"
      );
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-new-cell-label")
      );
    } else if (propertiesSet.has("read")) {
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-read-cell-label")
      );
    } else if (propertiesSet.has("unread")) {
      document.l10n.setAttributes(
        this.statusIndicator,
        "tree-list-view-row-not-read-status"
      );
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-unread-cell-label")
      );
    }

    if (propertiesSet.has("attach")) {
      ariaLabelPromises.push(
        document.l10n.formatValue("threadpane-attachments-cell-label")
      );
    }

    // Display number of replies in the twisty button.
    const repliesCount = parseInt(data.total) - 1;
    if (repliesCount > 0) {
      document.l10n.setAttributes(this.replies, "threadpane-replies", {
        count: repliesCount,
      });
    }

    Promise.allSettled(ariaLabelPromises).then(results => {
      this.setAttribute(
        "aria-label",
        results
          .map(settledPromise => settledPromise.value ?? "")
          .filter(value => value.trim() != "")
          .join(", ")
      );
    });
  }

  #updateTwistyButton() {
    if (!this.classList.contains("children")) {
      this.twistyButton.removeAttribute("data-l10n-id");
      this.twistyButton.removeAttribute("aria-expanded");
      this.twistyButton.removeAttribute("aria-label");
      return;
    }

    const isCollapsed = this.classList.contains("collapsed");
    document.l10n.setAttributes(
      this.twistyButton,
      isCollapsed
        ? "tree-list-view-row-expand-thread-button"
        : "tree-list-view-row-collapse-thread-button"
    );
    this.twistyButton.ariaExpanded = String(!isCollapsed);
  }
}
customElements.define("thread-card", ThreadCard, {
  extends: "tr",
});
