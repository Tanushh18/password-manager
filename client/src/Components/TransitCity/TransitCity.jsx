import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { trains as makeTrains, skyline, buses as makeBuses, arrival as makeArrival, announcements } from "../../lib/transit";
import "./TransitCity.css";

const STAMP = { ok: "✓", warn: "!", danger: "✕", idle: "•" };
const still = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* Background world: sky, jungle hills, waterfall into the river, airport tower and runway. */
function World() {
  return (
    <svg className="tc-world" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="tc-hill tc-hill--far" d="M0 170C120 120 220 110 330 140S560 120 680 135 920 110 1030 130 1160 120 1200 128V300H0z" />
      <path className="tc-hill" d="M0 190C90 150 170 158 250 176S420 150 520 170 700 160 820 178 1040 150 1200 176V300H0z" />
      {/* waterfall from the left cliff into the river */}
      <path className="tc-cliff" d="M0 120c40-6 70 6 96 30v150H0z" />
      <rect className="tc-falls" x="78" y="142" width="14" height="96" rx="6" />
      <rect className="tc-falls tc-falls--b" x="83" y="142" width="5" height="96" rx="2.5" />
      {/* river under the railway */}
      <path className="tc-river" d="M60 238C240 226 420 246 620 236S980 228 1200 240V258C980 248 800 254 620 254S240 246 60 256z" />
      <path className="tc-river-shine" d="M120 246C300 238 460 252 640 245S980 238 1180 248" />
      {/* runway on the right */}
      <rect className="tc-runway" x="930" y="182" width="270" height="10" rx="2" />
      <path className="tc-runway-marks" d="M945 187h18M985 187h18M1025 187h18M1065 187h18M1105 187h18M1145 187h18" />
      <path className="tc-tower" d="M1170 182v-58h7v58zM1162 124h23l-3-12h-17z" />
      <rect className="tc-tower-glass" x="1165" y="115" width="17" height="6" rx="1" />
    </svg>
  );
}

/**
 * Transit City: the vault as a city that builds itself, trains of items verified at the
 * station by a robot inspector, project buses on the road, the newest item landing at
 * the airport, and an LED ticker of announcements. Everything is real state; no secrets.
 */
export default function TransitCity({ items = [], health = {}, projects = [] }) {
  const info = health.info || {};
  const lines = useMemo(() => makeTrains(items, info), [items, info]);
  const towers = useMemo(() => skyline(items, info), [items, info]);
  const fleet = useMemo(() => makeBuses(projects), [projects]);
  const landing = useMemo(() => makeArrival(items), [items]);
  const ticker = useMemo(() => announcements({ items, health, projects }), [items, health, projects]);
  const [slot, setSlot] = useState(0);
  const train = lines.length ? lines[slot % lines.length] : null;

  // Next train every 9 seconds; with reduced motion the first train just waits at the platform.
  useEffect(() => {
    if (lines.length < 2 || still()) return undefined;
    const t = window.setInterval(() => setSlot((s) => s + 1), 9000);
    return () => window.clearInterval(t);
  }, [lines.length]);

  const verified = train ? train.cars.filter((c) => c.state === "ok").length : 0;
  return (
    <section className="tc" aria-label="Transit City: your vault as a city">
      <header className="tc__head">
        <span className="tc__title"><span aria-hidden="true">🚉</span> Stashr Central</span>
        <span className="tc__legend" aria-hidden="true"><i className="is-ok" />verified <i className="is-warn" />check <i className="is-danger" />held</span>
      </header>

      <div className="tc__stage">
        <World />
        <span className="tc-orb" aria-hidden="true" />
        <span className="tc-cloud" aria-hidden="true" />
        <span className="tc-cloud tc-cloud--b" aria-hidden="true" />
        <span className="tc-birds" aria-hidden="true">〰 〰 〰</span>

        {/* the city: one building per item, rising one after another */}
        <div className="tc-city" aria-hidden="true">
          {towers.map((b, i) => (
            <span key={b.id} className={`tc-bld is-${b.state} ${b.lit ? "is-lit" : ""}`} style={{ height: b.height, animationDelay: `${i * 70}ms` }}>
              {i % 5 === 2 ? <span className="tc-crane" /> : null}
            </span>
          ))}
          {!towers.length ? <span className="tc-city__empty">Empty plot · your city grows as you save logins</span> : null}
        </div>

        {/* airport: the newest item lands */}
        {landing ? (
          <div className="tc-plane" key={landing.id} aria-hidden="true">
            <span className="tc-plane__body">✈</span>
            <span className="tc-plane__tag">{landing.name}</span>
          </div>
        ) : null}

        {/* station platform with the robot inspector */}
        <div className="tc-station" aria-hidden="true">
          <span className="tc-station__sign">STASHR CENTRAL</span>
          <span className="tc-inspector">🤖<span className="tc-scan" /></span>
        </div>

        {/* railway */}
        <div className="tc-rail" aria-hidden="true" />
        {train ? (
          <div className="tc-train" key={train.code + slot} aria-hidden="true">
            <span className="tc-loco"><b>{train.code}</b></span>
            {train.cars.map((c, i) => (
              <span key={c.id} className={`tc-car is-${c.state}`} title={c.name} style={{ "--d": `${2.4 + i * 0.35}s` }}>
                <span className="tc-car__name">{c.name}</span>
                <span className="tc-car__stamp">{STAMP[c.state]}</span>
              </span>
            ))}
            {train.extra ? <span className="tc-car tc-car--more">+{train.extra}</span> : null}
          </div>
        ) : null}

        {/* road with project buses */}
        <div className="tc-road" aria-hidden="true">
          <span className="tc-stop">🚏</span>
          {fleet.map((b, i) => (
            <span key={b.id} className={`tc-bus is-${b.state}`} style={{ animationDelay: `${-i * 4.5}s` }}>
              <b>{b.route}</b> {b.name} <span className="tc-bus__driver">🤖</span>
            </span>
          ))}
        </div>

        {/* jungle life */}
        <span className="tc-critter tc-critter--elephant" aria-hidden="true">🐘</span>
        <span className="tc-critter tc-critter--monkey" aria-hidden="true">🐒</span>
        <span className="tc-critter tc-critter--boat" aria-hidden="true">🛶</span>
      </div>

      <div className="tc__ticker" role="marquee" aria-label="Station announcements">
        <div className="tc__tickertrack">
          {[...ticker, ...ticker].map((l, i) => <span key={i} aria-hidden={i >= ticker.length ? "true" : undefined}>◆ {l}</span>)}
        </div>
      </div>

      <p className="sr-only">
        {train ? `${train.label} train at the platform: ${train.total} items, ${verified} verified.` : "No trains yet."}
        {` ${towers.length} buildings in the city. ${fleet.length} project buses on the road.`}
        {landing ? ` Newest arrival: ${landing.name}.` : ""}
      </p>
      <footer className="tc__foot">
        <Link to="/passwords" className="btn btn--quiet btn--sm">Open the vault</Link>
        <Link to="/security-center" className="btn btn--quiet btn--sm">Inspect held items</Link>
        {fleet.length ? <Link to="/projects" className="btn btn--quiet btn--sm">Bus depot (projects)</Link> : null}
      </footer>
    </section>
  );
}
