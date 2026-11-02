# Tablet and phone test plan (Stashr Hub)

Nothing in the Android app has been run on a real device yet: it is only compiled, unit-tested and linted.
This file is the running list of what to test. **Add every new feature here when it is built**, and tick items off
(`[x]`) with the date and the result when tested. Put problems under "Found".

## 0. Connect the tablet from the terminal (adb)
```bash
adb devices                       # tablet must show as "device" (USB debugging on; Wi-Fi: adb connect <ip>:5555)
adb install -r Stashr-Hub.apk     # APK from the /apps page or the GitHub release stashr-hub-v…
adb logcat -s StashrHub:V AndroidRuntime:E *:S    # watch while testing; share the output when something fails
adb shell dumpsys activity activities | grep -i stashr.hub    # which screen is open
adb shell pm grant com.tanush.stashr.hub android.permission.CAMERA   # (optional) skip a permission dialog
```
Adb access gives only a terminal on your computer. The app still talks to the Stashr server by itself.

## 1. Install and pair
- [ ] APK installs; app opens in the Stashr look (light and dark).
- [ ] Smart home → "Add a tablet or a family phone" makes a code; typing it in the app pairs it (tablet).
- [ ] The tablet shows on the Smart home page as online within a minute; the same for a family phone (second code).
- [ ] A used or expired code is refused.

## 2. Tablet: Wi-Fi scan
- [ ] Wi-Fi rows appear with IP, names (where the device shares one) and ports.
- [ ] Phone reconnects with a new IP: it keeps its row and label (name key).
- [ ] Give a device a person: "Who is home" updates; leaving Wi-Fi marks them out after ~15 min.
- [ ] Risky-port flags look right on a device you know.

## 3. Tablet: camera (security camera)
- [ ] Start from the page: the app asks for camera permission once; "Watching" shows.
- [ ] Walk into view: photo reaches the page gallery and Telegram within seconds; a clip follows.
- [ ] Live view opens on the page for 2 minutes with a new frame every ~1.5 s.
- [ ] Stop from the page: the camera closes (no green dot).
- [ ] **Auto camera** (Camera card, switch on, needs a person set): everyone out for 2 min → camera starts and Telegram says so; someone back → camera stops. A camera you started by hand is not stopped.

## 4. Tablet: voice and music
- [ ] "Hey Stashr, tv ki awaaz kam karo" does it and speaks the reply (Hindi and English).
- [ ] "Arijit ke gaane chalao" plays in YouTube Music on the tablet.
- [ ] "Stashr today updates" / "aaj ke updates" (voice, page and Telegram) opens **Today at home** on the tablet by itself, even from another app. If not: "Display over other apps" permission.
- [ ] Mic button on the website works in Chrome.

## 5. Tablet: dashboard, slideshow, speed, wake
- [ ] Dashboard: clock, weather (set the city on the page), people, TV, scenes, "Ask Stashr".
- [ ] Photo slideshow starts after 10 idle minutes (Drive folder set) and from "photos dikhao"; a tap exits.
- [ ] Speed test runs hourly and from "Test now"; the chart gets a point.
- [ ] Wake-on-LAN wakes a PC whose MAC you typed in its Wi-Fi row.

## 6. Family phone
- [ ] Battery, storage, memory and model show within ~15 min, and soon after joining the Wi-Fi.
- [ ] Low battery shows correctly; charging shows.

## 7. Places and WhatsApp (the fragile one)
- [ ] Phone: "Share my location" on; permissions "while using" then "Allow all the time"; "last fix" updates.
- [ ] Tablet: Accessibility switch on (Android 13+: App info → ⋮ → Allow restricted settings); lock screen is None/Swipe.
- [ ] Tablet dashboard "WhatsApp messages" → send a test to a small test group: WhatsApp opens, group chosen, message sent, app returns to the dashboard.
- [ ] Page → Places → "Send test" does the same.
- [ ] Walk or drive into the circle inside the time window: the arrive message goes once. Outside the window: nothing.
- [ ] Walk out of the circle: the leave message goes (inside its window only). Standing on the edge does not repeat it.
- [ ] Tablet offline: Telegram says the message was not sent.
- [ ] Group with a long name or similar names: the right one is picked.

## 7b. Arrival time and Telegram control
- [ ] Page → Automations → Places → Home location saved (use your phone's browser at home).
- [ ] Phone: location sharing on (battery saver, no notification in the drawer). Go out ~5 km and come back: the tablet banner and the page's Home screen card show “… minute mein aa rahe hain”; Telegram says it once when within 15 min.
- [ ] Check battery use of Stashr Hub on the phone after a day (Settings → Battery); try Precise mode only if the ETA is too slow.
- [ ] Phone with an aggressive battery saver (Xiaomi/Oppo/Vivo): does the ETA still update? (turn battery optimisation off for the app)
- [ ] Telegram: “pause the tv”, “volume up”, “camera photo” (photo comes back), “kaun ghar par hai”, “papa kab aayenge”, “today”, /who, /camera on.
- [ ] Page → Overview → “What is switched on” matches reality; “Open” jumps to the right tab.

## 8. Updates (OTA)
- [ ] Push a change under `hub-app/` to `main`; the GitHub Release is created and is **not** "latest".
- [ ] The app (or "check_update") finds it, verifies it and Android asks for one tap to install.
- [ ] `GET /api/mobile-updates/hub/latest?currentVersionCode=1` on the live server returns the release.

## 9. Alerts and automations (server)
- [ ] Telegram bot connected; new device, unknown device at night and arrive/leave alerts arrive.
- [ ] Morning brief at its time; "Send a test" works. Weekly report on Sunday 20:00.
- [ ] TV: daily limit action, late-night warning, schedules at their minute (check the time zone).
- [ ] Scenes ("movie night") send their commands.

## Found
_(Write problems here: what you did, what happened, `adb logcat` lines.)_

## To add when built
_(New features go in the sections above; write a line here first if it does not fit.)_
