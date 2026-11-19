/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Read-receipt lookups for the Superhuman-style layout. Runs as a system
 * module because the mail window's CSP blocks network requests.
 */

const ID = /^[a-f0-9]{32}$/;
const MAX_AGE_MS = 45000;
const cache = new Map();

export const SuperhumanReceipts = {
  get host() {
    return Services.prefs.getCharPref(
      "mail.superhuman.receipts.host",
      "r.amplifi.studio"
    );
  },

  get token() {
    return Services.prefs.getStringPref("mail.superhuman.receipts.token", "");
  },

  get configured() {
    return !!this.token;
  },

  opensFor(id) {
    return cache.get(id)?.opens ?? null;
  },

  /**
   * Fetch opens for the given receipt ids, skipping ones fetched recently.
   * Notifies "superhuman-receipts-updated" with the ids whose opens changed.
   *
   * @param {string[]} ids
   * @param {boolean} [force=false]
   * @returns {Promise<boolean>} false when not configured or the call failed.
   */
  async refresh(ids, force = false) {
    if (!this.configured) {
      return false;
    }
    const now = Date.now();
    const want = [...new Set(ids)].filter(
      id =>
        ID.test(id) &&
        (force || !cache.has(id) || now - cache.get(id).at > MAX_AGE_MS)
    );
    const changed = [];
    try {
      for (let i = 0; i < want.length; i += 200) {
        const chunk = want.slice(i, i + 200);
        const response = await fetch(
          `https://${this.host}/api/opens?ids=${chunk.join(",")}`,
          {
            headers: { Authorization: `Bearer ${this.token}` },
            cache: "no-store",
          }
        );
        if (!response.ok) {
          return false;
        }
        const data = await response.json();
        for (const id of chunk) {
          const opens = data[id] || [];
          if ((cache.get(id)?.opens.length ?? -1) != opens.length) {
            changed.push(id);
          }
          cache.set(id, { opens, at: now });
        }
      }
    } catch (e) {
      console.error("read receipts refresh failed", e);
      return false;
    }
    if (changed.length) {
      Services.obs.notifyObservers(
        null,
        "superhuman-receipts-updated",
        changed.join(",")
      );
    }
    return true;
  },
};
