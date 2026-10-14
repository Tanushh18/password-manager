# Next up (planned 15 Oct 2026)

## 1. Cron jobs in Stashr
- Create and manage Render cron jobs from Stashr (like web services today: create, deploy, see runs/logs).
- Show them alongside the project they belong to (group by GitHub repo, same as the Services page).

## 2. Simplified server view
- One simple card per server: name, up/down, last deploy, URL, quick actions.
- Hide the advanced details (metrics, env vars, deploy history) behind "More".

## 3. Instant "server down" notification in the app
- As soon as a server goes down, send a push notification to the mobile app (not only Telegram).
- Today's monitoring: `.github/workflows/monitor-tick.yml` calls the monitor tick every ~5 min
  (GitHub schedules can be late), which raises incidents and sends Telegram alerts.
- To make it immediate: run the check from the server itself (or a Render cron job) every minute,
  and send a push via Expo / FCM to the registered devices when an incident opens (and when it recovers).
- Avoid spam: alert once per incident, plus a "back up" message.
