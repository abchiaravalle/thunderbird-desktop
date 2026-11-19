# Superhuman look: measured target (from the 8 reference pictures)

Pictures: /Volumes/6154577230/AUX-OFFLOAD/hermes/claude-code/_archived-workdirs/superhuman-clone/project/superhuman-pictures
Contact sheet: ~/src/tb-glass/ref/sheet.png. Pictures are ~2x; sizes below are at 1x.

## Window
- ONE white card. No toolbar band, no search field, no menu/hamburger on the right,
  no status bar, no app rail, no folder sidebar. macOS window buttons only.
- Behind it on the Mac: Liquid Glass (desktop shows through, blurred) around the card edge.

## Split tabs (top of the card)
- Left: one thin hamburger (2 lines), then tabs: "Important 7  Calendar 3  Docs 8  Other 1".
- Tab label ~19px, regular weight. Active = blue->lavender gradient text (#65abff -> #b4a2f6).
  Inactive = #999. Count = ~14px, lighter (#b3b3b3), same baseline, 6px after the label.
- Gap between tabs is constant (~26px). Tab row ~70px tall. NO divider line under it.
- First tab label starts on the same x as the sender column below (x = 52px at 1x).

## Rows
- 44px pitch. White. No dividers, no avatars, no checkboxes, no stars, no icons.
- Columns: sender (name only, #1a1a1a, 15px, fixed ~210px, starts at x=52)
  | label chip (pastel fill, white 12px lowercase, radius 4, only if the row has that label,
    never the label of the current split) | subject (#1a1a1a 15px)
  | preview (#999, same size, runs to the edge and fades) | date (right, #999 13px).
- Selected row: neutral #fafafa tint, full-height 3px violet bar #714cb6 at the left edge.
- Unread: sender + subject semibold. Read: regular.

## Open conversation (03, 04, 07)
- Replaces the list in the same card. No header bar, no action buttons, no avatar,
  no To/Cc lines, no "Important" badge.
- Older messages collapse to one line each: name (bold #1a1a1a, fixed col) + one-line
  snippet (#999). ~42px pitch.
- Newest message expanded: small grey line "↩  Me to Colleen" (or "Maria to Me"), then body
  at ~17px, line-height ~1.6, #1a1a1a, generous left padding (~40px).
- Receipts (07): "✓" after the recipients line in accent; click -> floating white card
  "Opened 6 times" (gradient title) with rows: device icon, name, date.
- Reply box (03/04/08): sits directly under the newest message, inside the same card.
  Draft text at the same size as the body. Under it, plain grey text actions
  "Send    Send later    Remind me" (no buttons, no borders). Auto-draft variant has a
  2px gradient border (blue->lavender) and title "Auto Draft to Maria".
- Toast (04): wide gradient pill (blue->lavender) "Reminder set: Monday July 10th if no reply"
  + "UNDO" chip.

## Type
- System sans (SF Pro) is acceptable; sizes are larger than Thunderbird's (15px rows,
  17px message body, 19px tabs).
