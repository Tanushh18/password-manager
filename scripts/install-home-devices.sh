#!/usr/bin/env bash
# Installs the latest Stashr apps from the GitHub releases on the home tablet and the TV over adb, and turns on the
# permissions that adb is allowed to give. Run it on a computer that is on the same Wi-Fi as the tablet and the TV.
#
#   scripts/install-home-devices.sh --tablet 192.168.1.20 --tv 192.168.1.30
#   scripts/install-home-devices.sh --tablet 192.168.1.20                # only the tablet
#   scripts/install-home-devices.sh --tv 192.168.1.30                    # only the TV
#   scripts/install-home-devices.sh --phone-apk                          # only download the Stashr Location APK
#
# Needs: adb, curl, python3. On each device: Developer options -> USB debugging (and Network/Wireless debugging) on.
set -euo pipefail

REPO="${STASHR_REPO:-Tanushh18/stashr-Home-Automation}"
OUT="${STASHR_APK_DIR:-$HOME/stashr-apks}"
TABLET="" TV="" PHONE_APK=0 PORT=5555
while [ $# -gt 0 ]; do
  case "$1" in
    --tablet) TABLET="$2"; shift 2 ;;
    --tv) TV="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --phone-apk) PHONE_APK=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TABLET$TV" ] || [ "$PHONE_APK" = 1 ] || { echo "Give --tablet <ip>, --tv <ip> or --phone-apk." >&2; exit 2; }
for c in adb curl python3; do command -v "$c" >/dev/null || { echo "Missing: $c" >&2; exit 1; }; done
mkdir -p "$OUT"

# Newest published release whose tag starts with $1 (stashr-hub-v, stashr-tv-v, stashr-where-v) -> the URL of asset $2.
asset_url() {
  curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=60" | python3 -c '
import json, sys
prefix, name = sys.argv[1], sys.argv[2]
for r in json.load(sys.stdin):
    if r.get("draft") or not str(r.get("tag_name", "")).startswith(prefix):
        continue
    for a in r.get("assets", []):
        if a.get("name") == name:
            print(a["browser_download_url"]); sys.exit(0)
sys.exit(1)' "$1" "$2"
}
download() {   # prefix asset file
  local url; url="$(asset_url "$1" "$2")" || { echo "No release found for $1 ($2). Is the build finished on GitHub?" >&2; exit 1; }
  echo "Downloading $url"
  curl -fL --retry 3 -o "$OUT/$3" "$url"
  ls -l "$OUT/$3"
}
dsh() { adb -s "$SERIAL" shell "$@"; }

connect() {   # ip -> sets SERIAL
  SERIAL="$1:$PORT"
  adb connect "$SERIAL" | tee /dev/stderr | grep -qiE "connected|already" || { echo "Could not connect to $SERIAL. Turn on Network debugging, or plug in USB and run: adb tcpip $PORT" >&2; exit 1; }
  adb -s "$SERIAL" get-state >/dev/null 2>&1 || { echo "$SERIAL is not authorised: accept the 'Allow USB debugging' prompt on the screen (tick Always allow) and run again." >&2; exit 1; }
}

setup_tablet() {
  local pkg=com.tanush.stashr.hub
  download stashr-hub-v stashr-hub.apk stashr-hub.apk
  connect "$TABLET"
  adb -s "$SERIAL" install -r "$OUT/stashr-hub.apk"
  for p in CAMERA RECORD_AUDIO POST_NOTIFICATIONS; do dsh pm grant "$pkg" "android.permission.$p" 2>/dev/null || true; done
  dsh appops set "$pkg" SYSTEM_ALERT_WINDOW allow 2>/dev/null || true       # announcements over other apps
  dsh dumpsys deviceidle whitelist "+$pkg" >/dev/null 2>&1 || true          # no battery optimisation
  dsh settings put global stay_on_while_plugged_in 3 2>/dev/null || true    # screen stays on while charging
  dsh monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  echo "Tablet done. On the tablet: type the home-device code from the website (Smart home -> Devices -> Link the home tablet or TV)."
  echo "WhatsApp messages need Accessibility on (Hub dashboard -> WhatsApp messages) and a tablet lock of None/Swipe."
}

setup_tv() {
  local pkg=com.tanush.stashr.tv
  download stashr-tv-v stashr-tv.apk stashr-tv.apk
  connect "$TV"
  adb -s "$SERIAL" install -r "$OUT/stashr-tv.apk"
  dsh pm grant "$pkg" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
  dsh appops set "$pkg" SYSTEM_ALERT_WINDOW allow 2>/dev/null || true       # banners over a playing video
  dsh dumpsys deviceidle whitelist "+$pkg" >/dev/null 2>&1 || true
  # the "Stashr TV remote" accessibility service (Home/Back commands, which app is on screen)
  local svc="$pkg/$pkg.access.RemoteAccessibilityService" cur
  cur="$(dsh settings get secure enabled_accessibility_services | tr -d '\r')"
  case "$cur" in *"$svc"*) ;; ""|null) dsh settings put secure enabled_accessibility_services "$svc" ;; *) dsh settings put secure enabled_accessibility_services "$cur:$svc" ;; esac
  dsh settings put secure accessibility_enabled 1
  dsh cmd package set-home-activity "$pkg/.ui.HomeActivity" >/dev/null 2>&1 || echo "Choose Stashr TV as the home app on the TV when it asks."
  dsh monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  echo "TV done. On the TV: type the same home-device code and a name (Living room TV). Plug in the USB drive for movies."
}

[ "$PHONE_APK" = 1 ] && { download stashr-where-v stashr-where.apk stashr-location.apk; echo "Send $OUT/stashr-location.apk to each family phone (or use the /apps page on the phone)."; }
[ -n "$TABLET" ] && setup_tablet
[ -n "$TV" ] && setup_tv
echo "All done."
