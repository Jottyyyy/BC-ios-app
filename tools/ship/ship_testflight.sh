#!/usr/bin/env bash
#
# Build, sign, verify and upload a TestFlight build. One command, macOS + Xcode only.
#
#   tools/ship/ship_testflight.sh            # auto-bump the build number, then ship
#   tools/ship/ship_testflight.sh 44         # ship as build 44 exactly
#   tools/ship/ship_testflight.sh --dry-run  # build + verify + validate, but DO NOT upload
#
# The point of this script is the VERIFY steps. Apple reports success while doing nothing:
# `xcodebuild -exportArchive` prints EXPORT SUCCEEDED while silently dropping an entitlement the
# provisioning profile does not carry, and the app then fails at runtime instead of at build time.
# So this decodes the artifact and reads the entitlements back, and refuses to upload if any
# entitlement declared in ios/Biyaherong.entitlements is missing from the signed binary.
#
# Credentials: needs an App Store Connect API key. Put the ids in ~/.appstoreconnect/asc.env
#   export ASC_KEY_ID=XXXXXXXXXX
#   export ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
# and the private key at ~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8  (chmod 600).
# NEVER put a .p8 in this repo - *.p8 is gitignored for exactly that reason.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IOS="$ROOT/ios"
OUT="$HOME/BiyaherongBuilds"
PROJ="$IOS/project.yml"
ENTS="$IOS/Biyaherong.entitlements"

DRY_RUN=0
BUILD_ARG=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=1 ;;
    *[0-9]*)   BUILD_ARG="$a" ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
say "Preflight"
[ -f "$PROJ" ] || fail "no ios/project.yml - run this from the repo"
pgrep -x Xcode >/dev/null && fail "Xcode is running. Quit it: xcodegen rewrites the project underneath it."
command -v xcodegen >/dev/null || fail "xcodegen not installed (brew install xcodegen)"

[ -f "$HOME/.appstoreconnect/asc.env" ] && . "$HOME/.appstoreconnect/asc.env"
: "${ASC_KEY_ID:?set ASC_KEY_ID (see the header of this script)}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID (see the header of this script)}"
KEYFILE="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
[ -f "$KEYFILE" ] || fail "no API key at $KEYFILE"
echo "    API key $ASC_KEY_ID"

# the signing settings must be TARGET-scoped in project.yml, never -xcodebuild overrides:
# as overrides they also hit SwiftPM's BiyaherongUI_BiyaherongUI bundle, which rejects profiles.
grep -q 'CODE_SIGN_STYLE: Manual' "$PROJ" || fail "project.yml is not set to Manual signing"

# ------------------------------------------------------------- build number
CUR=$(grep -E '^\s*CURRENT_PROJECT_VERSION:' "$PROJ" | head -1 | tr -dc '0-9')
if [ -n "$BUILD_ARG" ]; then NEW="$BUILD_ARG"; else NEW=$((CUR + 1)); fi
if [ "$NEW" != "$CUR" ]; then
  say "Build number $CUR -> $NEW"
  /usr/bin/python3 - "$PROJ" "$CUR" "$NEW" <<'PY'
import re, sys
p, cur, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding='utf-8', newline='').read()
s2 = re.sub(r'(CURRENT_PROJECT_VERSION:\s*")%s(")' % re.escape(cur), r'\g<1>%s\g<2>' % new, s, count=1)
assert s2 != s, "could not rewrite CURRENT_PROJECT_VERSION"
open(p, 'w', encoding='utf-8', newline='').write(s2)
PY
else
  say "Build number $NEW (unchanged)"
fi
VERSION=$(grep -E '^\s*MARKETING_VERSION:' "$PROJ" | head -1 | sed 's/.*"\(.*\)".*/\1/')
echo "    shipping $VERSION ($NEW)"

# ------------------------------------------------------------------ archive
ARCHIVE="$OUT/Biyaherong-$VERSION-$NEW.xcarchive"
EXPORT="$OUT/export-$VERSION-$NEW"
mkdir -p "$OUT"
rm -rf "$ARCHIVE" "$EXPORT"

say "Generating the Xcode project"
( cd "$IOS" && xcodegen generate >/dev/null )

# This script sets NO build settings, which used to mean it shipped the app's fail-open default:
# a granted subscription and a sign-in performing no Apple authentication. That is the hole the
# BIYA_TESTBUILD inversion closed, and this is the assertion that keeps it closed. Same principle
# as verify_entitlements below - on this pipeline an exit code is not evidence, so read the
# EFFECTIVE settings back out of xcodebuild rather than trusting the file.
say "Verifying this is a REAL build (no BIYA_TESTBUILD)"
FLAGS=$( cd "$IOS" && xcodebuild -project Biyaherong.xcodeproj -scheme Biyaherong \
    -configuration Release -showBuildSettings 2>/dev/null \
    | grep SWIFT_ACTIVE_COMPILATION_CONDITIONS || true )
echo "    ${FLAGS:-(none)}"
case "$FLAGS" in
  *BIYA_TESTBUILD*)
    fail "BIYA_TESTBUILD reached the compiler - this build would grant the subscription to
    everyone and fake the sign-in. Release must not carry it; only 'configs: Debug' in
    ios/project.yml and the two codemagic TEST workflows may set it." ;;
  *) echo "    ok - real sign-in, real StoreKit" ;;
esac

say "Archiving (SIGNED - an unsigned archive cannot carry an entitlement)"
( cd "$IOS" && xcodebuild -project Biyaherong.xcodeproj -scheme Biyaherong \
    -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" archive ) >"$OUT/archive.log" 2>&1 \
  || { grep -E ': error:' "$OUT/archive.log" | sort -u | head -20; fail "archive failed (full log: $OUT/archive.log)"; }
echo "    ok"

# ------------------------------------------------------- verify + export
verify_entitlements() { # $1 = path to .app, $2 = label
  local app="$1" label="$2" got
  got=$(codesign -d --entitlements :- "$app" 2>/dev/null || true)
  [ -n "$got" ] || fail "$label is not signed at all"
  /usr/bin/python3 - "$ENTS" "$label" <<PY
import plistlib, sys, re
want = list(plistlib.load(open(sys.argv[1], 'rb')).keys())
got  = """$got"""
missing = [k for k in want if k not in got]
print("    %s entitlements: %s" % (sys.argv[2], ", ".join(want) if want else "(none declared)"))
if missing:
    print("\033[31m    MISSING: %s\033[0m" % ", ".join(missing))
    sys.exit(1)
print("    all declared entitlements present")
PY
}

say "Verifying the ARCHIVE carries every declared entitlement"
verify_entitlements "$ARCHIVE/Products/Applications/Biyaherong.app" "archive" \
  || fail "the archive lost an entitlement - is the capability enabled on the App ID, and the profile regenerated AFTER that?"

say "Exporting / signing"
( cd "$IOS" && xcodebuild -exportArchive -archivePath "$ARCHIVE" \
    -exportOptionsPlist ExportOptions.plist -exportPath "$EXPORT" ) >"$OUT/export.log" 2>&1 \
  || { tail -20 "$OUT/export.log"; fail "export failed (full log: $OUT/export.log)"; }
IPA="$EXPORT/Biyaherong.ipa"
[ -f "$IPA" ] || fail "no .ipa produced"
echo "    $(du -h "$IPA" | cut -f1)  $IPA"

say "Verifying the SIGNED .ipa - the only check that has ever caught this"
rm -rf "$EXPORT/x" && mkdir -p "$EXPORT/x" && unzip -q "$IPA" -d "$EXPORT/x"
verify_entitlements "$EXPORT/x/Payload/Biyaherong.app" "ipa" \
  || fail "EXPORT SUCCEEDED but the entitlement was dropped. Not uploading."

echo "    version $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$EXPORT/x/Payload/Biyaherong.app/Info.plist") ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$EXPORT/x/Payload/Biyaherong.app/Info.plist"))"

# ------------------------------------------------------------------ deliver
say "Validating with Apple (free, consumes nothing)"
xcrun altool --validate-app -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1 | tail -6

if [ "$DRY_RUN" = "1" ]; then
  say "--dry-run: stopping before upload"
  echo "    .ipa kept at $IPA"
  exit 0
fi

say "Uploading to App Store Connect"
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1 | tail -8

cp "$IPA" "$OUT/Biyaherong-$VERSION-$NEW.ipa"
say "Shipped $VERSION ($NEW)"
cat <<EOF

    Archive : $ARCHIVE
    IPA     : $OUT/Biyaherong-$VERSION-$NEW.ipa

    Now:
      1. Record the delivery UUID above in CHANGELOG.md and commit the build-number bump.
      2. TestFlight shows the build in a few minutes, under "Version $VERSION".
         Internal groups get it with no review; external testing needs Beta App Review.
EOF
