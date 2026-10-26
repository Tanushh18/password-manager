import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useVault } from "../../state/vault";
import "./InfraTabs.css";

/* One "Infrastructure" area: the Control Center, Usage, Map and Cron share one tab bar instead of three separate nav entries. */
export default function InfraTabs() {
  const { profile } = useVault();
  const f = profile?.features || {};
  const tabs = [
    ...(f.servers !== false ? [{ to: "/render", label: "Control Center" }] : []),
    ...(f.services !== false ? [{ to: "/services", label: "Usage" }, { to: "/services/map", label: "Map" }] : []),
    ...(f.cron !== false ? [{ to: "/cron", label: "Cron & alerts" }] : []),
  ];
  return (
    <>
      <nav className="infratabs" aria-label="Control Center">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end className={({ isActive }) => `infratabs__tab ${isActive ? "is-active" : ""}`}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
