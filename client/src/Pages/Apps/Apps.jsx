import React from "react";
import { Link } from "react-router-dom";
import Ambience from "../../Components/Ambience/Ambience";
import "./Apps.css";

// The APK is a static file served by this site, so /apps works with no extra server. Keep in step with mobile/app.json.
const APK = { file: "/apps/stashr.apk", version: "2.2.0" };

const FEATURES = [
  "Passwords, 2FA codes and secure notes, unlocked with your fingerprint or face",
  "Photo backup: new photos and videos upload automatically to your connected Google accounts",
  "Photo folders, albums, people and a full viewer, the same as the website, plus the photos and videos already on your phone",
  "Servers, deployments, monitoring and moving a server between Render accounts",
  "Same account and same server as the website, so everything stays in sync",
];

export default function Apps() {
  return (
    <div className="apps page">
      <Ambience petals={false} />
      <article className="shell-narrow apps__doc card anim-fade-up">
        <span className="card__ribbon" />
        <p className="eyebrow">Android · version {APK.version}</p>
        <h1>Stashr for Android</h1>
        <p className="lede">Your vault, photos and servers in your pocket. Sign in with the account you use on the website.</p>
        <a className="btn btn--primary apps__download" href={APK.file} download="stashr.apk">Download APK</a>
        <h2>What you get</h2>
        <ul>{FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
        <h2>How to install</h2>
        <ol>
          <li>Open this page on your Android phone and tap <strong>Download APK</strong>.</li>
          <li>Open the downloaded file. If Android asks, allow installs from your browser.</li>
          <li>Open Stashr, sign in, and turn on photo backup in the Photos tab.</li>
        </ol>
        <p className="apps__note">Updates install over the old app and keep your data. If a previous build refuses to update, uninstall it first.</p>
        <p className="privacy__back"><Link to="/">← Back to Stashr</Link></p>
      </article>
    </div>
  );
}
