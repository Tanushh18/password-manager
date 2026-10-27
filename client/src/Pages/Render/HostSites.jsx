import React from "react";
import { Section } from "./RenderUi";
import { safeUrl } from "./renderUtils";

/** Sites and projects on the other connected hosts (Vercel, Netlify, Railway, Cloudflare Pages), each tagged with its platform. */
export default function HostSites({ data }) {
  const { sites, errors } = data;
  if (!sites.length && !errors.length) return null;
  return (
    <Section title={<>Other hosts <span className="rd-badge">{sites.length}</span></>} subtitle="Static sites and servers on Vercel, Netlify, Railway and Cloudflare Pages">
      {errors.map((e, i) => <div key={i} className="rd-alert rd-alert--error" role="alert"><span aria-hidden="true">!</span><div>{e.label} · {e.accountName}: {e.error}</div></div>)}
      <ul className="rd-hostlist">
        {sites.map((x) => (
          <li key={x.provider + x.accountId + x.id}>
            <span className={"rd-host rd-host--" + x.provider}>{x.label}</span>
            <strong>{x.name}</strong>
            <small>{x.kind === "server" ? "Server" : "Static site"} · {x.accountName}{x.repo ? " · " + x.repo : ""}{x.branch ? " @ " + x.branch : ""}</small>
            {x.url ? <a href={safeUrl(x.url)} target="_blank" rel="noreferrer noopener">{x.url.replace(/^https?:\/\//, "")} ↗</a> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
