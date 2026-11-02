# Stashr apps (what each one is for)

All are listed with download buttons on the website's **/apps** page.

| App | Who installs it | What it does | What it can see |
|---|---|---|---|
| **Stashr for Android** (`mobile/`) | You | Vault, 2FA, photo backup, servers | Everything of yours |
| **Stashr Hub** (`hub-app/`, `com.tanush.stashr.hub`) | The always-on home tablet (and optionally a phone to report its health) | Wi-Fi scan with names, security camera, "Hey Stashr" voice, dashboard, slideshow, speed tests, WhatsApp sender, announcements | Home data only. Joins with a pairing code, never your password |
| **Stashr Location** (`where-app/`, `com.tanush.stashr.where`) | Each family member's phone | Shares only location, battery and "on Wi-Fi yes/no" | Nothing of the vault. Joins with the fixed code + the person's name |
| **Browser extension** (`extension/`) | You | Autofill | Your vault |

## Stashr Hub (the home tablet)
- **Link:** website → Smart home → Devices → *Link the home tablet* shows one fixed 8-letter **tablet code** (copy / "New code"). In
  Stashr Hub type the code and a name for the tablet. A one-time 15-minute code still works as an alternative.
- The tablet code is separate from the family-phone code: a tablet can see the home dashboard and your slideshow photos, so only you
  should have it.

## Stashr Location (family phones)
- **Link:** website → Smart home → Devices → *Family locations* shows one fixed 8-letter code (copy / "New code"). In the app type the code,
  the person's name and press Connect. The phone then appears in that card. It stays linked until you press Disconnect there, or the
  person presses Disconnect in the app.
- **Home location:** set once on the website (Smart home → Automations → Places → *Home location*). It applies to every phone.
- **Privacy:** only `lat, lon, accuracy, speed`, battery level and "Wi-Fi connected + its address" are sent, only to your server.
  The server never sends the app anything but its own state and short notices.
- **Battery and no notification:** no foreground service. The app takes one fix at a time. The server tells it when to look next
  (`nextCheckSec`): every 30 min when far away and not heading home, every 15 min when away but near, every 20 min at home, and
  every 10 → 5 → 2 → 1 min as someone heading home gets closer (>20 km, >10 km, >3 km, closer). Heading home is detected from two
  fixes getting closer. Plus a free source: passive fixes other apps cause (uploaded only after moving 300 m).
- **What the family sees:** the tablet shows a banner "Parveen 10 minute mein aa rahe hain", reads out "Parveen Chawla is arriving in
  15 mins" (also at 5 mins) and "Open the door: Parveen Chawla arrived home"; the TV gets the same text (`notify`, only when the TV is
  on); other linked phones get it as a normal notification; Telegram gets it too. Arrival counts when the phone is inside the home
  circle, or the tablet sees the phone on the Wi-Fi and it is within 2 km: whichever happens first.
- **Fixed-code safety:** the code is only useful to someone who adds *their own* phone to your list (it gives them no access to anything).
  Linking is rate-limited and capped by the device limit. Replace the code any time; linked phones stay linked.
- **ETA:** straight line × 1.3 at the phone's speed (or 25 km/h); good to a few minutes, no traffic data.

## Two servers
Stashr runs on two servers that share one database (`password-manager-server-g305` and `password-manager-server-xxdr`, the same list
the main app uses). Stashr Hub and Stashr Location keep both addresses (Setup → Advanced → server and backup server), try the one
that worked last, and move to the other when it is asleep or down (no connection, or HTTP 502–504). A device token works on either.

## Updates
Stashr Hub and Stashr Location are built by GitHub Actions (`hub-apk.yml`, `where-apk.yml`) on every change under their folder,
signed with the same keystore secrets, and published as GitHub Releases (`stashr-hub-v…`, `stashr-where-v…`) that are never marked
"latest". The API serves them at `/api/mobile-updates/hub/*` and `/api/mobile-updates/where/*`; the apps check themselves and Android
asks for one tap to install.

## Known limits
- **TV screen messages** need the TV app (separate repo `tv-movie-sync`) to understand the `notify` command; until it does, the TV
  command fails harmlessly and the tablet, phones and Telegram still get the message.
- Phone makers (Xiaomi, Oppo, Vivo, Samsung) may pause background apps; Stashr Location has a button to its battery settings.
- Android 12+ "approximate location" makes the ETA rough; choose Precise.
