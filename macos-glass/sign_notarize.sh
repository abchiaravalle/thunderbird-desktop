#!/bin/bash
# sign_notarize.sh <package.tar> : Developer ID sign "Thunderbird Glass.app", notarize, staple, zip.
# Never launches the app.
#
# There is no local Developer ID identity on this Mac: team 9V2BAER3Y9 signs Developer ID through
# Xcode's cloud signing. So: (1) pre-sign every nested piece with the team's Apple Development
# identity using Mozilla's own hardened-runtime layout and entitlements
# (comm/taskcluster/config.yml hardened-sign-config, production), (2) wrap the app in an .xcarchive,
# (3) `xcodebuild -exportArchive` method developer-id, which re-signs all nested code with the
# cloud Developer ID certificate and keeps each piece's entitlements, (4) notarize + staple.
set -euo pipefail
PKG="${1:?package tar}"
ROOT="$HOME/src/tb-glass"
ENT="$ROOT/firefox/comm/build/macosx/hardenedruntime/v2/production"
WORK="$ROOT/ship"
OUT="$ROOT/dist"
DEV_ID="Apple Development: Adam Chiaravalle (B48YXEM85R)"
set -a; source "$HOME/.hermes/secrets/asc/asc.env"; set +a
rm -rf "$WORK"; mkdir -p "$WORK/unpack" "$OUT"
tar -xf "$PKG" -C "$WORK/unpack"
SRC=$(ls -d "$WORK"/unpack/*/*.app | head -1)
NAME=$(basename "$SRC")
ARC="$WORK/ThunderbirdGlass.xcarchive"
mkdir -p "$ARC/Products/Applications"
mv "$SRC" "$ARC/Products/Applications/"
APP="$ARC/Products/Applications/$NAME"
M="$APP/Contents/MacOS"
echo "[$(date +%H:%M:%S)] pre-sign $NAME"

sign() {  # entitlements-file-or-empty, path...
  local ent="$1"; shift
  for p in "$@"; do
    [ -e "$p" ] || continue
    if [ -n "$ent" ]; then
      codesign --force --options runtime --timestamp=none --entitlements "$ent" -s "$DEV_ID" "$p"
    else
      codesign --force --options runtime --timestamp=none -s "$DEV_ID" "$p"
    fi
  done
}

# Inner Mach-O files first (anything executable not inside a nested bundle we sign as a unit).
while IFS= read -r f; do
  file -b "$f" | grep -q "Mach-O" || continue
  sign "" "$f"
done < <(find "$APP/Contents" -type f \( -perm +111 -o -name "*.dylib" \) \
           ! -path "*/plugin-container.app/*" ! -path "*/media-plugin-helper.app/*" \
           ! -path "*/security-module-helper.app/*" ! -path "*/updater.app/*" \
           ! -path "*/crashreporter.app/*" ! -path "*/gpu-helper.app/*" \
           ! -path "*.framework/*" ! -path "*.mdimporter/*" ! -path "$M/thunderbird" 2>/dev/null)
sign "$ENT/plugin-container.xml"       "$M/plugin-container.app"
sign "$ENT/media-plugin-helper.xml"    "$M/media-plugin-helper.app"
sign "$ENT/security-module-helper.xml" "$M/security-module-helper.app"
sign "" "$M/updater.app/Contents/Frameworks/UpdateSettings.framework" "$M/updater.app" \
  "$M/crashreporter.app" "$M/gpu-helper.app" "$APP/Contents/Frameworks/ChannelPrefs.framework" \
  "$APP/Contents/Library/Spotlight/thunderbird.mdimporter"
sign "$ENT/browser.xml" "$APP"
codesign --verify --deep --strict "$APP"

ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Contents/Info.plist")
VER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist")
BUILD=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$APP/Contents/Info.plist")
cat > "$ARC/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>ApplicationProperties</key><dict>
  <key>ApplicationPath</key><string>Applications/$NAME</string>
  <key>Architectures</key><array><string>arm64</string></array>
  <key>CFBundleIdentifier</key><string>$ID</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundleVersion</key><string>$BUILD</string>
  <key>SigningIdentity</key><string>$DEV_ID</string>
  <key>Team</key><string>$ASC_TEAM_ID</string>
</dict>
<key>ArchiveVersion</key><integer>2</integer>
<key>CreationDate</key><date>$(date -u +%Y-%m-%dT%H:%M:%SZ)</date>
<key>Name</key><string>ThunderbirdGlass</string>
<key>SchemeName</key><string>ThunderbirdGlass</string>
</dict></plist>
EOF
cat > "$WORK/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>developer-id</string>
<key>teamID</key><string>$ASC_TEAM_ID</string>
<key>signingStyle</key><string>automatic</string>
</dict></plist>
EOF
echo "[$(date +%H:%M:%S)] export developer-id (Xcode cloud signing)"
PATH=/usr/bin:/bin:/usr/sbin:/sbin xcodebuild -exportArchive -archivePath "$ARC" -exportPath "$WORK/export" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" -allowProvisioningUpdates > "$WORK/export.log" 2>&1 \
  || { grep -iE "error" "$WORK/export.log" | sort -u | head -12; echo "EXPORT FAILED"; exit 1; }
APP="$WORK/export/$NAME"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2
codesign -dv "$APP" 2>&1 | grep -E "Authority=Developer|TeamIdentifier|flags"
echo "nested Developer ID check:"
bad=0
while IFS= read -r f; do
  file -b "$f" | grep -q "Mach-O" || continue
  a=$(codesign -dvv "$f" 2>&1 | sed -n 's/^Authority=\(Developer ID Application.*\)$/\1/p' | head -1)
  [ -n "$a" ] || { echo "  NOT Developer ID: ${f#$APP/}"; bad=1; }
done < <(find "$APP/Contents" -type f \( -perm +111 -o -name "*.dylib" \))
[ $bad = 0 ] && echo "  every Mach-O is Developer ID"
for p in "Contents/MacOS/plugin-container.app" ""; do
  echo "  entitlements ${p:-app}:"; codesign -d --entitlements - --xml "$APP/$p" 2>/dev/null | plutil -p - 2>/dev/null | grep -o 'com.apple.security[^"]*' | sed 's/^/    /'
done

echo "[$(date +%H:%M:%S)] notarize (a few minutes for a ~400 MB app)"
ditto -c -k --keepParent "$APP" "$WORK/notarize.zip"
xcrun notarytool submit "$WORK/notarize.zip" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" \
  --wait --timeout 60m > "$WORK/notary.log" 2>&1 || true
grep -E "id:|status:" "$WORK/notary.log" | tail -3
if ! grep -q "status: Accepted" "$WORK/notary.log"; then
  SUB=$(grep -m1 -E "^\s*id:" "$WORK/notary.log" | awk '{print $2}')
  [ -n "$SUB" ] && xcrun notarytool log "$SUB" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" 2>&1 \
    | grep -E '"message"|"path"' | head -20
  echo "NOTARIZATION NOT ACCEPTED"; exit 1
fi
xcrun stapler staple "$APP" | tail -1
xcrun stapler validate "$APP" | tail -1
spctl -a -vvv -t execute "$APP" 2>&1 | head -3
ZIP="$OUT/Thunderbird-Glass-mac.zip"
rm -f "$ZIP"; ditto -c -k --keepParent "$APP" "$ZIP"
ls -la "$ZIP"; shasum -a 256 "$ZIP"
echo "SIGNED_APP=$APP"
