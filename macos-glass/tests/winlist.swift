// winlist <pid> -> all windows of pid with layer, bounds, name, onscreen
import CoreGraphics
import Foundation
let pid = Int32(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == pid {
  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  print(w[kCGWindowNumber as String] ?? 0, "layer", w[kCGWindowLayer as String] ?? -1,
        "onscreen", w[kCGWindowIsOnscreen as String] ?? false,
        "\(b["X"] ?? 0),\(b["Y"] ?? 0) \(b["Width"] ?? 0)x\(b["Height"] ?? 0)",
        w[kCGWindowName as String] ?? "")
}
