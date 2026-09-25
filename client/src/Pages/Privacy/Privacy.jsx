import React from "react";
import { Link } from "react-router-dom";
import Ambience from "../../Components/Ambience/Ambience";
import "./Privacy.css";

const UPDATED = "25 September 2026";

/** Plain-language privacy policy (also used for the Play Store listing). */
export default function Privacy() {
  return (
    <div className="privacy page">
      <Ambience petals={false} />
      <article className="shell-narrow privacy__doc card anim-fade-up">
        <span className="card__ribbon" />
        <p className="eyebrow">Last updated {UPDATED}</p>
        <h1>Privacy policy</h1>
        <p className="lede">
          Aurelia is a password manager. It is built so that we <strong>cannot</strong> read what you store in it.
        </p>

        <h2>What we store</h2>
        <ul>
          <li><strong>Your account:</strong> name, email address and a bcrypt hash of your master password (used to sign you in).</li>
          <li><strong>Your vault:</strong> items encrypted on your device with AES-256-GCM. The key is derived from your master password with PBKDF2-SHA256 (600,000 rounds) and never leaves your device. We store only the encrypted data, a random salt and an encrypted check value.</li>
          <li><strong>Sessions:</strong> signed login tokens so you stay signed in, for up to 30 days per device.</li>
          <li><strong>Two-factor login (optional):</strong> your authenticator secret, encrypted on the server, and hashes of your recovery codes.</li>
        </ul>

        <h2>What we can't see</h2>
        <p>
          Item names, usernames, passwords, websites, notes and stored 2FA secrets are encrypted before they reach us. Accounts created
          before end-to-end encryption are migrated automatically the first time you unlock them on an updated app or website.
        </p>

        <h2>Third parties</h2>
        <ul>
          <li><strong>Have I Been Pwned</strong> — only when you run a breach check. We send the first five characters of each password's SHA-1 hash (k-anonymity); the password itself is never sent.</li>
          <li><strong>DuckDuckGo icons</strong> — only if you turn on website icons. Your browser asks DuckDuckGo for the icon of each saved website's domain.</li>
          <li><strong>Hosting</strong> — the API runs on Render and the database on MongoDB Atlas.</li>
        </ul>
        <p>We don't use ads, analytics or trackers, and we never sell data.</p>

        <h2>Your choices</h2>
        <ul>
          <li>Export your vault at any time as an encrypted backup or a CSV (Settings → Your data).</li>
          <li>Delete your account and every item in it at any time (Settings → Danger zone). Deletion is immediate.</li>
        </ul>

        <h2>Your master password</h2>
        <p>
          Because only you hold the key, <strong>we cannot reset or recover your master password</strong>. If you forget it, your vault
          can't be decrypted. Keep an encrypted backup somewhere safe.
        </p>

        <h2>Contact</h2>
        <p>Questions? Open an issue on the project's GitHub repository.</p>

        <p className="privacy__back"><Link to="/" className="btn btn--ghost btn--sm">Back home</Link></p>
      </article>
    </div>
  );
}
