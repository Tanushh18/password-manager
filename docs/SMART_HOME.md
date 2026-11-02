# Smart home (Stashr Home)

The **Smart home** page shows your TV, the Wi-Fi at home, the family's phones and the tablet camera, and controls
them from anywhere.

```
TV (Stashr launcher) ──home Wi-Fi──► Tablet (Stashr Hub app) ──internet──► this server ──► the Smart home page
Family phones (Stashr Hub, phone mode) ──────────────internet──────────────►    │          Telegram bot
                                                                                └──► scheduled jobs (every minute)
```

## Joining: pairing codes
A tablet or a family phone joins with a code, so nobody types the Stashr password on it. On the page, **Add a tablet
or a family phone** makes an 8-letter code (`POST /home/pair-codes`, valid 15 minutes, works once, only its SHA-256 is
stored in `HomePairCode`). The device sends it to `POST /home/agent/pair` and gets its own device token. That token can
only call `/home/agent/*` (report, media, dashboard, slideshow, assistant, scene) and the movie endpoints, never the
vault. The older TV/tablet sign-in (`POST /home/devices`, kinds `tv` and `hub`) still works.

## What the page shows
- **Ask Stashr**: typed or spoken (mic button, Chrome/Edge speech recognition in `hi-IN` or `en-IN`). Understands
  volume, play/pause, apps, YouTube links, songs ("arijit ke gaane chalao" plays on the tablet with YouTube Music;
  "tv par … songs" opens YouTube on the TV), scenes by name, "kaun ghar par hai", "camera on/off/photo/clip",
  "speed test", "wake <computer>", "photos dikhao". Rules in `utils/homeAssistant.js`; routing in `runSentence`
  (`router/home.js`), which is shared with the tablet's microphone (`POST /home/agent/assistant`).
- **Scenes**: one tap runs several commands ("Movie night", "Quiet", "Good night" by default; editable).
- **Who is home**: a person is home when a Wi-Fi device you gave that person answers, or their paired phone's own
  address answers on the tablet's scan (`home.presence`).
- **TV**: status, remote, USB movies, as before.
- **Tablet (Wi-Fi)**: every device on the Wi-Fi with its own name where the device shares one, reply time, open ports
  (risky ones flagged: Telnet, ADB, SMB, RDP, RTSP, VNC…), tags (mine / family / guest / unknown), person, room, an
  optional MAC for Wake-on-LAN. Rows can be **merged** ("same device as") or **forgotten**; devices not seen for a
  day fold away. A family phone's battery and storage show on its Wi-Fi row.
- **Family phones**: model, Android version, battery (level, charging, temperature, health), storage, memory, uptime,
  network.
- **Camera**: watch for movement, take a photo, record a 10 s clip; sensitivity; gallery (14 days, 300 items max).
- **TV time**: minutes per day by app (chart + table), a daily limit (pause / home screen / just tell me, repeated
  every 15 minutes past the limit), a late-night warning.
- **Internet speed**: hourly tests from the tablet, chart over 1–90 days, "Test now".
- **Schedules**: commands at a time of day on chosen weekdays, in the account's time zone (default Asia/Kolkata).
- **Alerts and briefs**: Telegram alerts for a new device, an unknown device at night, someone arriving or leaving,
  nobody home with the TV on, camera movement (with the photo and clip); a morning brief (weather from Open-Meteo,
  who is home, TV yesterday, Wi-Fi overnight, speed) and a Sunday weekly report.
- **Movies from Google Drive** and the **photo slideshow** folder (images from Drive, shown on the tablet).
- A timeline of everything (60 days).

## Movies from Google Drive
Pick the Google account connected in Photo Cloud and a Drive folder. Movies put in that folder are copied to the TV's
USB drive. Listing and downloading work with Photo Cloud's read-only access. **Removing a movie from Drive once the
TV has it** needs the Google connection to have full Drive access (`https://www.googleapis.com/auth/drive`); Stashr
says so when it does not. A movie is only removed when the TV reports a complete copy with the same name and size.

## The Stashr Hub app (`hub-app/`)
A native Kotlin Android app (package `com.tanush.stashr.hub`, min Android 8), one APK for both jobs; the pairing
code decides which. Its screens use the website's colours and card style (`core/Ui.kt`), light and dark.
- **Home tablet** (`core/HubService.kt`, a foreground service): every minute it scans the /24 Wi-Fi (`net/`): ping and
  TCP probes, names from the router's reverse DNS, mDNS / Bonjour and NetBIOS, ports every 30 minutes; an internet
  speed test every hour; reports to `POST /home/agent/report` and runs the commands that come back (`scan_now`,
  `speed_test`, `check_update`, `wake`, `play_music`, `camera`, `slideshow`). The camera (`camera/`, CameraX) is a security
  camera started and stopped from the page ("Start security camera"; it stays closed while off). It compares frames
  for movement, uploads a JPEG at once, then records while the movement lasts (up to 60 s) and uploads the MP4, to
  `POST /home/agent/media`. Live view: the page asks for 2 minutes of frames; the tablet sends a small JPEG every
  ~1.5 s to `POST /home/agent/live` (newest frame per tablet in `HomeLiveFrame`), and the page reads
  `GET /home/camera/live`. "Hey Stashr" (`voice/`)
  listens with Android speech recognition and sends the sentence to the assistant; songs play through YouTube Music.
  The dashboard and slideshow are in `ui/`.
- **Family phone** (`phone/`): WorkManager reports battery, storage, memory, model, network and Wi-Fi address about
  every 15 minutes (Android's minimum for background work) and when the phone joins a network.
- **Updates**: `.github/workflows/hub-apk.yml` builds a signed APK on every change to `hub-app/` (same signing secrets
  as the main app, versionCode 100000 + run number, version from `hub-app/version.txt`) and publishes a GitHub Release
  tagged `stashr-hub-v…`, never marked latest. The server serves it at `GET /api/mobile-updates/hub/latest` and
  `/hub/download` (`router/mobileUpdates.js`); the app checks every 6 hours or on the `check_update` command, verifies
  the SHA-256 and hands it to Android's installer, which asks for one tap. The website's `/apps` page links the same
  download.
- Build locally: `cd hub-app && ./gradlew assembleDebug` (needs the Android SDK; `local.properties` with `sdk.dir`).

## What it cannot do (and why)
- **Switch the TV off**: the current TV app has no power-off command, so limits and scenes pause it and go to the
  home screen.
- **Battery or storage of a phone without Stashr Hub**: the Wi-Fi only shows that a device is there; health comes
  only from phones running Stashr Hub in phone mode.
- **MAC addresses from the scan**: Android 10+ hides other devices' MACs from apps. Devices are told apart by the name
  they share, else by IP; add a MAC by hand for Wake-on-LAN. Some phones share no name and stay an IP.
- **Instant phone reports**: about every 15 minutes, plus when the phone changes network.
- **Silent updates**: Android always asks for a tap to install an app update.
- **Exact songs on the TV without a key**: with `YOUTUBE_API_KEY` set, "tv par … songs" plays the first matching
  video; without it the TV opens YouTube's search for it.

## Server pieces
- Models: `HomeDevice` (kinds `tv`, `hub`, `phone`), `HomeEvent`, `HomeMovieSettings`, `HomeSettings` (alerts,
  schedules, scenes, TV limit and usage, briefs, camera, slideshow), `HomePairCode`, `HomeClaim` (one server runs each
  scheduled job: several servers share the database), `HomeSpeed`, and GridFS bucket `homeMedia` for camera files.
- Routes: `router/home.js` (devices, reports, assistant, movies) and `router/homeMore.js` (pairing, settings,
  schedules, scenes, TV time, speed, camera media, tablet dashboard/slideshow/assistant/scene, Wi-Fi merge/forget,
  phone person, brief test); `router/mobileUpdates.js` (`/hub/latest`, `/hub/download`).
- Rules: `utils/home.js` (commands, Wi-Fi book with name keys, risky ports, presence), `utils/homeAutomation.js`
  (minute tick: TV time and limit, schedules, empty-home alert, briefs; Wi-Fi alert rules), `utils/homeMedia.js`,
  `utils/homeWeather.js` (Open-Meteo), `utils/homeYoutube.js`, `utils/homeAssistant.js`, `utils/homeSweep.js`
  (offline detection + the automation tick every minute), `utils/homeMovies.js` (Drive, also slideshow images).
- Optional env: `YOUTUBE_API_KEY` (YouTube Data API v3) for exact songs on the TV.
- Tests: `tests/home*.test.js` (incl. `homeMore.test.js`, `homeHubUpdates.test.js`), `tests/mpin.test.js`; web:
  `client/tests/smartHome.test.mjs`.

## MPIN sign-in
After one email-and-password sign-in, a device can turn on a 4-digit MPIN in Settings. The server gives the device a
long random secret once, and an MPIN sign-in needs the secret and the MPIN, so guessing four digits gets nowhere
without the device. Five wrong MPINs switch it off on that device. Changing or resetting the password switches off
every MPIN.
