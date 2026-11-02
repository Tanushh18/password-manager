#!/usr/bin/env bash
# Installs the latest Stashr apps from the GitHub releases on the home tablet and the TV over adb, and turns on the
# permissions that adb is allowed to give. Run it on a computer that is on the same Wi-Fi as the tablet and the TV.
#
#   scripts/install-home-devices.sh --tablet usb --tv auto               # tablet on the USB-C cable, TV found on the Wi-Fi by itself
#   scripts/install-home-devices.sh --tablet 192.168.1.20 --tv 192.168.1.30
#   scripts/install-home-devices.sh --tablet usb                         # only the tablet
#   scripts/install-home-devices.sh --tv auto                            # only the TV
#   scripts/install-home-devices.sh --phone-apk                          # only download the Stashr Location and Stashr Cast APKs
#   scripts/install-home-devices.sh --phone usb                          # install Stashr Location and Stashr Cast on a phone on the USB cable
#
# --tablet usb|<ip>   usb = the device on the cable (pass --serial <id> if several are plugged in)
# --tv auto|<ip>      auto = look for an Android TV on this Wi-Fi (adb mdns, then a scan of the /24 for port 5555)
# Needs: adb, curl, python3. On each device: Developer options -> USB debugging (TV: Network debugging) on.
set -euo pipefail

REPO="${STASHR_REPO:-Tanushh18/stashr-Home-Automation}"
OUT="${STASHR_APK_DIR:-$HOME/stashr-apks}"
TABLET="" TV="" PHONE="" PHONE_APK=0 PORT=5555 USB_SERIAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tablet) TABLET="$2"; shift 2 ;;
    --tv) TV="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --serial) USB_SERIAL="$2"; shift 2 ;;
    --phone-apk) PHONE_APK=1; shift ;;
    --phone) PHONE="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TABLET$TV$PHONE" ] || [ "$PHONE_APK" = 1 ] || { echo "Give --tablet <ip|usb>, --tv <ip|auto>, --phone usb or --phone-apk." >&2; exit 2; }
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

# The tablet on the USB-C cable: the one "device" in `adb devices` that is not a network address.
usb_device() {
  adb start-server >/dev/null 2>&1 || true
  local list; list="$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /:/ {print $1}')"
  local unauth; unauth="$(adb devices | awk 'NR>1 && $2=="unauthorized" && $1 !~ /:/ {print $1}')"
  if [ -n "$USB_SERIAL" ]; then SERIAL="$USB_SERIAL"; return; fi
  if [ -z "$list" ] && [ -n "$unauth" ]; then echo "The tablet is plugged in but not allowed yet: on its screen tap 'Allow USB debugging' (tick Always allow), then run this again." >&2; exit 1; fi
  if [ -z "$list" ]; then echo "No tablet on the cable. Plug it in, turn on Developer options -> USB debugging, and use a data cable (not a charge-only one)." >&2; exit 1; fi
  if [ "$(echo "$list" | wc -l)" -gt 1 ]; then echo "More than one USB device: pick one with --serial. Found:" >&2; echo "$list" >&2; exit 1; fi
  SERIAL="$list"
}

# Looks for an Android TV on this Wi-Fi and prints its address (host:port).
find_tv() {
  local cand=""
  # 1. devices that announce themselves (Android 11+ wireless debugging)
  cand="$(adb mdns services 2>/dev/null | awk '/_adb(-tls-connect)?\._tcp/ {print $NF}' | grep -E '^[0-9.]+:[0-9]+$' || true)"
  # 2. any host in this /24 with port 5555 open (older Android TV and 'Network debugging')
  cand="$cand
$(python3 - <<'PY'
import socket, concurrent.futures as cf
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8", 80)); me = s.getsockname()[0]
except OSError:
    me = ""
finally:
    s.close()
if me:
    base = ".".join(me.split(".")[:3])
    def probe(i):
        ip = f"{base}.{i}"
        if ip == me:
            return None
        try:
            with socket.create_connection((ip, 5555), timeout=0.4):
                return f"{ip}:5555"
        except OSError:
            return None
    with cf.ThreadPoolExecutor(64) as ex:
        for r in ex.map(probe, range(1, 255)):
            if r:
                print(r)
PY
)"
  local c
  for c in $(echo "$cand" | grep -E '^[0-9.]+:[0-9]+$' | sort -u); do
    adb connect "$c" >/dev/null 2>&1 || continue
    # an Android TV has the 'leanback' feature or the 'tv' characteristic
    if adb -s "$c" shell 'pm list features; getprop ro.build.characteristics' 2>/dev/null | grep -qiE 'leanback|(^|,)tv(,|$)'; then echo "$c"; return 0; fi
    adb disconnect "$c" >/dev/null 2>&1 || true
  done
  return 1
}

connect_tv() {   # "auto" or an ip -> sets SERIAL
  if [ "$1" = auto ]; then
    echo "Looking for the TV on this Wi-Fi…" >&2
    SERIAL="$(find_tv)" || { echo "Could not find the TV. On the TV turn on Developer options -> Network debugging (or Wireless debugging: then pair first with 'adb pair <ip>:<port> <code>' and run this again), keep it awake, and make sure this computer is on the same Wi-Fi. Or pass its address: --tv <ip>." >&2; exit 1; }
    echo "Found the TV at $SERIAL" >&2
    adb -s "$SERIAL" get-state >/dev/null 2>&1 || { echo "The TV has not allowed this computer yet: accept 'Allow USB debugging' on the TV screen (Always allow) and run again." >&2; exit 1; }
  else
    connect "$1"
  fi
}

connect() {   # ip -> sets SERIAL
  SERIAL="$1:$PORT"
  adb connect "$SERIAL" | tee /dev/stderr | grep -qiE "connected|already" || { echo "Could not connect to $SERIAL. Turn on Network debugging, or plug in USB and run: adb tcpip $PORT" >&2; exit 1; }
  adb -s "$SERIAL" get-state >/dev/null 2>&1 || { echo "$SERIAL is not authorised: accept the 'Allow USB debugging' prompt on the screen (tick Always allow) and run again." >&2; exit 1; }
}

setup_tablet() {
  local pkg=com.tanush.stashr.hub
  download stashr-hub-v stashr-hub.apk stashr-hub.apk
  if [ "$TABLET" = usb ]; then usb_device; else connect "$TABLET"; fi
  echo "Tablet: $SERIAL ($(dsh getprop ro.product.model | tr -d '\r'))"
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
  connect_tv "$TV"
  echo "TV: $SERIAL ($(dsh getprop ro.product.model | tr -d '\r'))"
  adb -s "$SERIAL" install -r "$OUT/stashr-tv.apk"
  dsh pm grant "$pkg" android.permission.POST_NOTIFICATIONS 2>/dev/null || true
  dsh appops set "$pkg" SYSTEM_ALERT_WINDOW allow 2>/dev/null || true       # banners over a playing video
  dsh appops set "$pkg" REQUEST_INSTALL_PACKAGES allow 2>/dev/null || true  # updates from the server install themselves
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

setup_phone() {   # a family phone on the USB cable: Stashr Location (+ Stashr Cast when it has been released)
  download stashr-where-v stashr-where.apk stashr-location.apk
  usb_device
  echo "Phone: $SERIAL ($(dsh getprop ro.product.model | tr -d '\r'))"
  adb -s "$SERIAL" install -r "$OUT/stashr-location.apk"
  dsh pm grant com.tanush.stashr.where android.permission.POST_NOTIFICATIONS 2>/dev/null || true
  if asset_url stashr-cast-v stashr-cast.apk >/dev/null 2>&1; then
    download stashr-cast-v stashr-cast.apk stashr-cast.apk
    adb -s "$SERIAL" install -r "$OUT/stashr-cast.apk"
    dsh pm grant com.tanush.stashr.cast android.permission.RECORD_AUDIO 2>/dev/null || true
    dsh pm grant com.tanush.stashr.cast android.permission.POST_NOTIFICATIONS 2>/dev/null || true
  fi
  echo "Phone done. Open Stashr Location, type the link code and the person's name; location must be 'Allow all the time'."
}

if [ "$PHONE_APK" = 1 ]; then
  download stashr-where-v stashr-where.apk stashr-location.apk
  if asset_url stashr-cast-v stashr-cast.apk >/dev/null 2>&1; then download stashr-cast-v stashr-cast.apk stashr-cast.apk; fi
  echo "Send the APKs in $OUT to each family phone (or use the /apps page on the phone)."
fi
[ -n "$PHONE" ] && setup_phone
[ -n "$TABLET" ] && setup_tablet
[ -n "$TV" ] && setup_tv
echo "All done."
