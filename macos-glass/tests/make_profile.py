#!/usr/bin/env python3
"""Build a throwaway Thunderbird profile with a made-up mailbox (example.com only).

Usage: make_profile.py <profile_dir> [--userchrome path.css]
No network accounts: one Local Folders server holding Inbox/Sent/Drafts/Archives.
"""
import os, sys, shutil, random, email.utils, datetime, textwrap, hashlib, json

PEOPLE = [
    ("Arlene McCoy", "arlene@northwind.example.com"),
    ("Savannah Nguyen", "savannah@hyperfusion.example.com"),
    ("Kristin Watson", "kristin@legal.example.com"),
    ("United Airlines", "receipts@united.example.com"),
    ("Esther Howard", "esther@acme.example.com"),
    ("Jenny Wilson", "jenny@acme.example.com"),
    ("Cody Fisher", "cody@globex.example.com"),
    ("Leslie Alexander", "leslie@initech.example.com"),
    ("Brooklyn Simmons", "brooklyn@umbrella.example.com"),
    ("Robert Fox", "robert@stark.example.com"),
    ("Jacob Jones", "jacob@wayne.example.com"),
    ("Theresa Webb", "theresa@acme.example.com"),
    ("Figma", "no-reply@figma.example.com"),
    ("Calendar", "calendar-notification@example.com"),
    ("Stripe", "receipts@stripe.example.com"),
    ("Product Hunt Daily", "hello@producthunt.example.com"),
]
# (sender idx, tag keyword or "", subject, snippet, unread, starred)
MAIL = [
    (0, "$label1", "Application for Product Manager position", "Hi there, I'm excited to apply for the PM role. My portfolio and resume are attached for your review.", 1, 0),
    (1, "$label1", "Hyperfusion <> Northwind Q2 Review", "A meeting to review Q2 results and plan the next quarter. Agenda attached, please add topics.", 1, 0),
    (2, "$label1", "Final contract signature needed", "Sending over the final version of the MSA. Two small edits on page 4, otherwise ready to sign.", 1, 1),
    (3, "$label4", "eTicket Itinerary and Receipt for Confirmation K7Q2LM", "Thank you for flying with us. Your trip to San Francisco on Dec 4 is confirmed. Seat 12A.", 0, 0),
    (4, "", "Q3 customer survey results", "Hey team, sharing the results from the Q3 survey. NPS went up 9 points, details inside.", 0, 0),
    (5, "", "Roadmap updates", "We've finalized our roadmap for the first half. Three big bets and a few smaller polish items.", 0, 0),
    (6, "$label2", "Design review moved to Thursday", "Quick heads up: the design review is now Thursday at 2pm. Same room, same link.", 1, 0),
    (7, "$label2", "Budget sign-off for the offsite", "Can you approve the revised offsite budget? We came in about 8% under the first estimate.", 0, 1),
    (8, "$label3", "Dinner on Saturday?", "Are you two free Saturday night? We were thinking the new place on Main around 7.", 0, 0),
    (9, "$label2", "Invoice #4821 is ready", "Your invoice for October is ready. Total due is $4,250.00 by November 30.", 0, 0),
    (10, "$label4", "Hotel confirmation: The Palace, Dec 4-7", "Your reservation is confirmed for three nights. Check-in after 3pm, late checkout requested.", 0, 0),
    (11, "$label5", "Can you look at the onboarding copy?", "I rewrote the onboarding screens. Would love your eyes before Friday, no rush on the rest.", 1, 0),
    (12, "", "Leslie commented on Homepage v3", "\"Love the new hero. Can we try the headline one size smaller?\" Reply in Figma.", 0, 0),
    (13, "", "Invitation: Weekly sync @ Mon 10am", "You have been invited to Weekly sync. Mondays 10:00 to 10:30. Join with the video link.", 1, 0),
    (14, "", "Your receipt from Northwind Studio", "Receipt #1932-4471. Amount paid $129.00. Thanks for your business.", 0, 0),
    (15, "", "Top products this week", "The five most upvoted launches this week, plus a short interview with a solo founder.", 0, 0),
    (6, "", "Re: API rate limits", "Thanks, raising the limit to 600 per minute worked. We'll monitor over the weekend.", 0, 0),
    (7, "$label1", "Board deck draft", "First pass of the board deck is in the shared folder. Slides 6 to 9 still need numbers.", 1, 0),
    (9, "", "Partnership intro", "Introducing you two, you should talk about the reseller program. I'll let you take it from here.", 0, 0),
    (10, "$label3", "Photos from the weekend", "Finally uploaded the photos from the lake. The sunset ones came out great.", 0, 1),
    (11, "$label2", "Hiring plan for Q1", "Here is the draft hiring plan. Two engineers, one designer, one support lead.", 0, 0),
    (1, "", "Re: Hyperfusion pilot pricing", "We can do the pilot at the lower tier if we sign by the 15th. Let me know what works.", 0, 0),
    (4, "$label5", "Reminder: expense reports due", "Please submit October expense reports by Friday so finance can close the month.", 0, 0),
    (0, "", "Thank you!", "Thanks again for the time today. Really enjoyed learning about the team.", 0, 0),
    (2, "", "NDA countersigned", "Attached is the countersigned NDA for your records. Talk soon.", 0, 0),
    (12, "", "New file shared: Pricing page", "Jenny Wilson shared \"Pricing page\" with you. Open in Figma to view.", 0, 0),
    (13, "", "Updated invitation: Quarterly planning", "This event has been updated. New time: Wed 1pm to 3pm.", 0, 0),
    (14, "", "Payout of $8,912.40 is on its way", "Your payout should arrive in your bank account within 2 business days.", 0, 0),
    (5, "$label2", "Launch checklist", "Here's the launch checklist. I marked the items that still need an owner.", 0, 0),
    (8, "", "Re: Book club pick", "I vote for the short one this time. Last month's was 600 pages.", 0, 0),
    (3, "", "Your trip is coming up", "Check in opens 24 hours before departure. Add your trip to your calendar.", 0, 0),
    (6, "", "Support ticket #2210 resolved", "The sync issue is fixed in the latest release. Let us know if it comes back.", 0, 0),
    (9, "$label1", "Security review findings", "Three medium findings, no highs. Full report attached with suggested fixes.", 0, 0),
    (15, "", "The weekly roundup", "Ten links worth your time, a new tool for writing changelogs, and a reader question.", 0, 0),
    (7, "", "Lunch next week?", "Want to grab lunch next week? Tuesday or Wednesday works for me.", 0, 0),
    (11, "", "Re: Onboarding copy", "Made the edits, thanks for the quick review. Shipping it Monday.", 0, 0),
    (4, "", "Customer interview notes", "Notes from five customer calls. Recurring theme: they want faster search.", 0, 0),
    (10, "", "Re: Offsite venue", "The venue can hold 40 people and has a projector. Deposit due next week.", 0, 0),
    (1, "", "Meeting notes: Q2 review", "Thanks all. Notes and action items are below. Next check-in in two weeks.", 0, 0),
    (2, "", "Signed: Statement of work", "The SOW is fully signed. Kickoff is set for the 3rd.", 0, 0),
]

ME = ("Lorem Ipsum", "adam@amplifi.studio")


def mbox_msg(frm, to, subject, body, date, unread, starred, tag, mid):
    status = 0x0000 if unread else 0x0001
    if starred:
        status |= 0x0004
    hdr = [
        f"From - {date.strftime('%a %b %d %H:%M:%S %Y')}",
        f"X-Mozilla-Status: {status:04x}",
        "X-Mozilla-Status2: 00000000",
        f"X-Mozilla-Keys: {tag}".rstrip() + " " * max(0, 80 - len(tag)),
        f"From: {email.utils.formataddr(frm)}",
        f"To: {email.utils.formataddr(to)}",
        f"Subject: {subject}",
        f"Date: {email.utils.format_datetime(date)}",
        f"Message-ID: <{mid}@example.com>",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
    ]
    body = body.replace("\nFrom ", "\n>From ")
    return "\n".join(hdr) + "\n\n" + body + "\n\n"


def main():
    prof = os.path.abspath(sys.argv[1])
    uc = None
    if "--userchrome" in sys.argv:
        uc = sys.argv[sys.argv.index("--userchrome") + 1]
    if os.path.exists(prof):
        shutil.rmtree(prof)
    lf = os.path.join(prof, "Mail", "Local Folders")
    os.makedirs(lf)
    now = datetime.datetime(2026, 11, 18, 17, 40, tzinfo=datetime.timezone(datetime.timedelta(hours=-5)))
    rnd = random.Random(7)
    inbox = []
    t = now
    for i, (si, tag, subj, snip, unread, star) in enumerate(MAIL):
        t = t - datetime.timedelta(minutes=rnd.randint(20, 300))
        body = snip + "\n\n" + textwrap.fill(
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. "
            "Praesent libero. Sed cursus ante dapibus diam. Sed nisi.", 72) + f"\n\n{PEOPLE[si][0].split()[0]}\n"
        mid = hashlib.md5(f"{i}{subj}".encode()).hexdigest()[:16]
        msg = mbox_msg(PEOPLE[si], ME, subj, body, t, unread, star, tag, mid)
        if si == 15:
            msg = msg.replace("MIME-Version: 1.0", "List-Unsubscribe: <https://example.com/unsubscribe?u=42>, <mailto:unsubscribe@producthunt.example.com>\nMIME-Version: 1.0", 1)
        inbox.append(msg)
    with open(os.path.join(lf, "Inbox"), "w") as f:
        f.write("".join(inbox))
    sent = []
    rids = json.loads(os.environ.get("SENT_RECEIPTS", "[]"))
    for i in range(6):
        p = PEOPLE[i]
        t2 = now - datetime.timedelta(hours=5 * i + 2)
        msg = mbox_msg(ME, p, f"Re: follow up {i+1}", "Sounds good, thanks!\n", t2, 0, 0, "", f"sent{i}")
        if i < len(rids):
            msg = msg.replace("MIME-Version: 1.0", f"X-Superhuman-Receipt: {rids[i]}\nMIME-Version: 1.0", 1)
        sent.append(msg)
    with open(os.path.join(lf, "Sent"), "w") as f:
        f.write("".join(sent))
    for name in ("Drafts", "Archives", "Trash", "Junk"):
        open(os.path.join(lf, name), "w").close()

    prefs = {
        "mail.accountmanager.accounts": "account1",
        "mail.accountmanager.localfoldersserver": "server1",
        "mail.accountmanager.defaultaccount": "account1",
        "mail.account.account1.server": "server1",
        "mail.account.account1.identities": "id1",
        "mail.identity.id1.fullName": ME[0],
        "mail.identity.id1.useremail": ME[1],
        "mail.identity.id1.valid": True,
        "mail.server.server1.type": "none",
        "mail.server.server1.hostname": "Local Folders",
        "mail.server.server1.name": "Inbox",
        "mail.server.server1.userName": "nobody",
        "mail.server.server1.directory-rel": "[ProfD]Mail/Local Folders",
        "mail.provider.suppress_dialog_on_startup": True,
        "mail.accounthub.enabled": False,
        "mailnews.start_page.enabled": False,
        "mail.shell.checkDefaultClient": False,
        "mail.spotlight.firstRunDone": True,
        "mail.winsearch.firstRunDone": True,
        "mail.rights.override": True,
        "mail.rights.version": 1,
        "toolkit.legacyUserProfileCustomizations.stylesheets": True,
        "app.update.disabledForTesting": True,
        "app.update.auto": False,
        "datareporting.policy.dataSubmissionEnabled": False,
        "datareporting.healthreport.uploadEnabled": False,
        "toolkit.telemetry.enabled": False,
        "toolkit.telemetry.reportingpolicy.firstRun": False,
        "browser.shell.checkDefaultBrowser": False,
        "extensions.update.enabled": False,
        "messaging-system.rsexperimentloader.enabled": False,
        "app.donation.eoy.version.viewed": 999,
        "mail.inappnotifications.enabled": False,
        "mail.biff.show_alert": False,
        "network.dns.disableIPv6": False,
        "mailnews.default_sort_order": 2,
        "mailnews.default_sort_type": 18,
        # Test harness only: the macOS Contacts address book blocks the UI thread
        # on a TCC consent prompt nobody can answer in a background run.
        "ldap_2.servers.osx.dirType": -1,
        "ldap_2.servers.osx.uri": "",
        "mail.showCondensedAddresses": False,
    }
    with open(os.path.join(prof, "user.js"), "w") as f:
        for k, v in prefs.items():
            if isinstance(v, bool):
                vs = "true" if v else "false"
            elif isinstance(v, int):
                vs = str(v)
            else:
                vs = '"' + v.replace('"', '\\"') + '"'
            f.write(f'user_pref("{k}", {vs});\n')
    if uc:
        os.makedirs(os.path.join(prof, "chrome"), exist_ok=True)
        shutil.copy(uc, os.path.join(prof, "chrome", "userChrome.css"))
    # Open straight on the Inbox (not the account-central page).
    session = {"rev": 0, "windows": [{"type": "3pane", "tabs": {"rev": 0, "selectedIndex": 0, "tabs": [
        {"mode": "mail3PaneTab", "state": {"firstTab": True, "folderPaneVisible": True,
                                            "folderURI": "mailbox://nobody@Local%20Folders/Inbox",
                                            "messagePaneVisible": True}}]}}]}
    with open(os.path.join(prof, "session.json"), "w") as f:
        if os.environ.get("WITH_SESSION"):
            json.dump(session, f)
        else:
            f.write("{}")
    print("profile ready:", prof, "inbox msgs:", len(inbox))


if __name__ == "__main__":
    main()
