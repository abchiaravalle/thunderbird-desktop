# Thunderbird, Superhuman look, Liquid Glass (macOS)

This branch (`superhuman-glass`) restyles Thunderbird's mail tab after
Superhuman and draws the window with macOS 26 Liquid Glass.

## What changes

- **Split inbox**: tabs above the list (Important, Team, Personal, Travel,
  To Do, Other) built from Thunderbird tags, with unread counts.
  Tab / Shift+Tab or Ctrl+1-9 switch splits.
- **One-line rows**: sender, label chips, subject, grey preview text, short
  date. Unread mail is bold. The selected row gets a thin accent bar.
- **Full-width reading**: Enter opens the conversation in place of the list,
  Esc goes back. Centred column, large subject, system font.
- **Keys** (Superhuman's map): J/K next/prev, E done (archive), # trash,
  ! spam, S star, U read/unread, R reply, Shift+R / Enter in a message
  reply all, F forward, C compose, H remind (stars it; Thunderbird has no
  snooze), L label, Shift+Y remove labels, Z undo, / search,
  G then I/S/D/T/E/!/# to jump to Inbox/Starred/Drafts/Sent/Done/Spam/Trash.
- **Cmd+K** opens a glass command palette listing every action and its key.
- **Glass window**: the window body uses the native sidebar material. With
  the engine patch in this folder, macOS 26+ draws it with
  `NSGlassEffectView` (Liquid Glass) instead of the older vibrancy.
  Content (list and message) stays on solid surfaces so text is easy to read.
- The left app rail, status bar and stock list header are hidden.

## Turning it off

Set `mail.superhuman.enabled` to `false` (Settings > General > Config
Editor) for stock Thunderbird. `widget.macos.sidebar-glass` switches the
Liquid Glass drawing back to the old vibrancy.

## Building

The app is "Thunderbird Glass" (bundle id `studio.amplifi.thunderbird-glass`, profile folder
`~/Library/Thunderbird Glass`), so it never shares data with an installed Thunderbird. Updater and
crash reporter are off in this build.

Sign + notarize: `macos-glass/sign_notarize.sh <obj>/dist/thunderbird-*.mac.tar` (Developer ID via
Xcode cloud signing, Mozilla's hardened-runtime entitlements, notarytool, staple).


`./macos-glass/build.sh` fetches the Firefox engine revision in `GECKO_REV`,
applies `gecko-liquid-glass-sidebar.patch` and runs a full build.
