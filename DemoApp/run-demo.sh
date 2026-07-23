#!/usr/bin/env bash
# Build the native macOS demo app (wraps the real BiyaherongCoachCore engines) and launch it.
# Usage: DemoApp/run-demo.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "▶ Building demo app…"
swift build -c release
BIN="$(swift build -c release --show-bin-path)/DemoApp"

BINDIR="$(swift build -c release --show-bin-path)"
APP="$PWD/BiyaherongCoachDemo.app"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/BiyaherongCoachDemo"
# Bundle.module resource bundles (e.g. the 80 MB puzzles.sqlite) live next to the SPM executable;
# copy them where Bundle.module will find them inside the .app.
for b in "$BINDIR"/*.bundle; do
    [ -e "$b" ] || continue
    cp -R "$b" "$APP/Contents/Resources/"
    cp -R "$b" "$APP/Contents/MacOS/"
done
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>BiyaherongCoachDemo</string>
<key>CFBundleIdentifier</key><string>com.biyaherong.coachdemo</string>
<key>CFBundleName</key><string>Biyaherong Coach Demo</string>
<key>CFBundleDisplayName</key><string>Biyaherong Coach Demo</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

echo "▶ Launching…"
open "$APP"
