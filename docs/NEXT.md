# Next up (planned 15 Oct 2026)

## v2.0.0 shipped 15 Oct — verify on the live site (stashr.tanush.qd.je)
- [ ] Projects: opens with "Auto-sync is on"; every repo of the connected GitHub token(s) shows up (source badge
      GitHub); hand-made projects stay untouched; archived ones are under the Archived tab.
- [ ] Projects: the 3 Deal-Radar projects → "Merge into one" banner → one card with a "N servers" dropdown.
- [ ] Render → Services: servers of one repo are one row with a dropdown; delete a service on Render → gone within ~30 s.
- [ ] Services (usage) page: deleted services are gone (list is read live every minute now, no 2-min cache).
- [ ] Render → Incidents: one row per outage, stale ones flagged ("Close it"), Resolve / Resolve all / Clear resolved work.
- [ ] Whole app re-syncs on its own: Projects 2 min, Render 30 s, Services 1 min, Incidents 1 min, server tick every 5 min.
- [ ] Render → Services: 🗑 on every row deletes a live or suspended service (type its name); "Delete selected" for several
      (type DELETE when a live one is included). The group checkbox selects only the main server.
- [ ] Projects → open a merged project (Deal-Radar): "Deployments" lists every server with its URL, status, last deploy; the env
      matrix shows which variables are common / differ (same letter = same value) / only on some servers / only in Stashr.
      Render → Services: each app and server shows its deployed URL.
- Known gaps: monitoring groups keep deleted services as members (only their incidents are auto-closed);
  GitHub forks are imported too (say if you want them skipped); "Sync now" does not merge duplicates (use the banner).

## 0. Check what shipped on 14 Oct (Projects ↔ Render sync)
- [ ] Projects page → "Sync with Render": duplicate Deal-Radar projects merge into one; repos running on any
      connected Render account without a project get one. Verify on stashr.tanush.qd.je with real data.
- [ ] "Merge into one" banner shows for projects with the same GitHub repo.
- [ ] Delete a service on Render → its link disappears from the project after the next check (page open or tick).
- [ ] Project env → "Push to Render" writes to EVERY Render service of that repo (all accounts) and can deploy all.
- [ ] Decide: delete the suspended duplicates dealradar-93do / dealradar-t04t on Render?
- Not built yet: creating projects for new Render repos happens only on "Sync with Render" (not automatic,
  so a project you delete isn't recreated). Make it automatic? Needs an "ignored repos" list.
- Not built yet: changing an env var doesn't push by itself; it's still the "Push to Render" button. Auto-push on save?
- Not built yet: committing env changes to GitHub (e.g. .env.example). "New commit" today = Render redeploy.

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
