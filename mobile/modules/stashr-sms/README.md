# stashr-sms

Local Expo module (Android) that reads bank SMS for Stashr's Money feature.

```js
import { smsSupported, hasPermission, requestPermission, readBankSms, getNewestBankSmsDate, hasNewSince, getLastArrival, setArrivalMatch } from "../../modules/stashr-sms";
```

| Call | Returns |
|---|---|
| `hasPermission()` | `boolean` — READ_SMS and RECEIVE_SMS both granted |
| `requestPermission()` | `Promise<boolean>` — shows Android's dialogs |
| `readBankSms({ sinceMs, limit = 500 (max 2000), match = "fed" })` | `Promise<[{ address, body, date }]>` oldest first, `date >= sinceMs` only, bodies cut at 600 chars; throws code `E_SMS_PERMISSION` without permission |
| `getNewestBankSmsDate(match?)` | `number \| null` (ms), looks at the 200 newest rows |
| `hasNewSince(lastSeenMs)` | `boolean` — a bank message may have arrived since; `true` when the receiver never recorded one |
| `getLastArrival()` | `number` (ms, 0 = never) |
| `setArrivalMatch(match)` | tells the arrival receiver which messages to note |

`match` is a case-insensitive regular expression tested on the sender **or** the text (an invalid regex is searched literally).

## Sideloaded app and SMS permission
Stashr is installed from an APK, not from the Play Store, so Android 13 and later hide the SMS permission until you allow it:
**Settings → Apps → Stashr → ⋮ (top right) → Allow restricted settings**, then open the app and grant SMS
(or Settings → Apps → Stashr → Permissions → SMS → Allow). Without this step the permission dialog does not appear.

## The arrival receiver
`SmsArrivalReceiver` listens for `SMS_RECEIVED` and, when a message matches, stores **only the time** in private preferences
(`stashr_sms` / `lastBankSmsArrival`). No text, no network. A background task can call `hasNewSince(lastSeenMs)` and skip the
full inbox read when nothing arrived. If the receiver is blocked (battery rules, RECEIVE_SMS denied) the value stays 0 and
`hasNewSince` answers `true`, so a periodic read still catches everything.

Outside Android (Expo Go, web) every call is a no-op returning `false` / `[]` / `null`.
