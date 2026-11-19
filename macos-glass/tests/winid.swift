// winid <pid>  -> prints "<windowNumber> <w>x<h>" of the largest on-screen window owned by pid
import CoreGraphics
import Foundation
let pid = Int32(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
var best: (Int, Int, Int)? = nil
for w in list {
  guard (w[kCGWindowOwnerPID as String] as? Int32) == pid,
        (w[kCGWindowLayer as String] as? Int) == 0,
        let b = w[kCGWindowBounds as String] as? [String: Any],
        let wd = b["Width"] as? Double, let ht = b["Height"] as? Double,
        let num = w[kCGWindowNumber as String] as? Int else { continue }
  if wd < 300 || ht < 200 { continue }
  if best == nil || Int(wd*ht) > best!.1 * best!.2 { best = (num, Int(wd), Int(ht)) }
}
if let b = best { print("\(b.0) \(b.1)x\(b.2)") } else { exit(1) }
