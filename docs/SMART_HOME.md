# Smart home (Stashr Home)

The **Smart home** page shows your TV and the Wi-Fi at home, and controls the TV, from anywhere.

```
TV (Stashr launcher) ──home Wi-Fi──► Tablet (Stashr Hub app) ──internet──► this server ──► the Smart home page
```

Only the tablet is added to Stashr. It signs in once with your email and password (the password is not kept) and
registers itself with its own device token, which can report and receive commands and nothing else. The TV pairs
with the tablet by itself and shows up on the page without a token of its own.

## What the page shows
- The TV: on, standby or off; what is on screen and playing; the USB drive and its movies; the Wi-Fi signal.
- The Wi-Fi devices the tablet pings: first and last seen, reply time, a name and room that you give them.
- A timeline (the TV came on, a movie was added, a device joined). Telegram tells you when the TV turns on or off.
- Commands for the TV: volume, play and pause, open an app or a YouTube link, remove a movie, Home and Back, and a
  sentence box ("volume up", "tv ki awaaz kam karo", "open netflix", "status").

## Movies from Google Drive
Pick the Google account connected in Photo Cloud and a Drive folder. Movies put in that folder are copied to the TV's
USB drive. Listing and downloading work with Photo Cloud's read-only access. **Removing a movie from Drive once the
TV has it** needs the Google connection to have full Drive access (`https://www.googleapis.com/auth/drive`); Stashr
says so when it does not. A movie is only removed when the TV reports a complete copy with the same name and size.

## Server pieces
- Models `HomeDevice`, `HomeEvent`, `HomeMovieSettings`, `MpinDevice`; routes in `router/home.js` and `router/mpin.js`.
- `utils/home.js` (rules), `utils/homeAssistant.js` (sentences to commands), `utils/homeSweep.js` (offline
  detection), `utils/homeMovies.js` (Drive).
- Tests: `tests/home*.test.js`, `tests/mpin.test.js`.

The tablet app and the TV app live in a separate repository (`tv-movie-sync`, kept on the laptop).

## To do: real device names on the Wi-Fi list
Today the Wi-Fi list shows only IP addresses, because the tablet app sends no names. IPs change when a phone
reconnects, so a name you give a device is lost with its old IP. To fix this:

- **Tablet app (`tv-movie-sync`, separate repository):** look up a name for every device it finds and send it as `name`
  in the scan. Ways to get one: reverse DNS against the router (`192.168.1.1`), mDNS / Bonjour (Android `NsdManager`)
  for iPhones, Macs and Chromecasts, and NetBIOS for Windows PCs. Android 10+ hides other devices' MAC addresses, so do
  not rely on a MAC. Some phones share no name at all and will still show an IP.
- **Server (`utils/home.js`):** the server already accepts `name`, `mac` and `vendor` per device (`mergeLan`), but
  `lanKey` keys the book and your labels by MAC, else IP. Make it fall back to the device name before the IP, so a
  label follows a phone when its IP changes.
- **Page (`SmartHome.jsx`):** show the reported name as the default title of each row, instead of repeating the IP.
- **Until then:** reserve a fixed IP for each phone in the router (DHCP reservation) so labels stay put.

## MPIN sign-in
After one email-and-password sign-in, a device can turn on a 4-digit MPIN in Settings. The server gives the device a
long random secret once, and an MPIN sign-in needs the secret and the MPIN, so guessing four digits gets nowhere
without the device. Five wrong MPINs switch it off on that device. Changing or resetting the password switches off
every MPIN.
