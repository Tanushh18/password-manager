import React, { useEffect, useState } from "react";
import { getHoursBudget } from "../../api/client";

const LEVEL_TEXT = { ok: "On track", warn: "80% used", over: "Over the limit" };

const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

/* Free-hours budget per Render account. An estimate from the instance counts Stashr samples (Render does not report hours
   used), so it always says so and points at the Render dashboard for the exact number. */
export default function HoursBudgetCard() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getHoursBudget()
      .then((res) => { if (alive) setData(res); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed || !data) return null;
  const accounts = Object.entries(data.budgets || {});
  if (!accounts.length) return null;

  return (
    <section className="sv-hours" aria-label="Free hours this month">
      <header>
        <h2>Free hours this month</h2>
        <small>Estimate, resets on the 1st (UTC). Check the Render dashboard for the exact number.</small>
      </header>
      {accounts.map(([accountId, b]) => (
        <article key={accountId} className={"sv-hours__row is-" + b.level}>
          <div className="sv-hours__top">
            <b>{b.usedHours} of {b.limitHours} h</b>
            <span>{LEVEL_TEXT[b.level] || b.level}</span>
          </div>
          <div className="sv-bar" role="progressbar" aria-valuenow={Math.round(b.percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Free hours used">
            <i style={{ width: Math.min(100, b.percent) + "%" }} />
          </div>
          <small>
            {b.projectedOver
              ? "At this pace it runs out before the month ends" + (day(b.runsOutAt) ? " (about " + day(b.runsOutAt) + ")" : "") + "."
              : "At this pace: about " + b.projectedHours + " h by month end."}
            {b.level !== "ok" ? " Plan a migration to another workspace before the month ends." : ""}
          </small>
        </article>
      ))}
    </section>
  );
}
