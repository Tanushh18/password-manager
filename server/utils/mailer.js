/*
 * Transactional email through Brevo. Configure on the server (Render → Environment):
 *   BREVO_API_KEY       your Brevo API key (xkeysib-…)
 *   BREVO_SENDER_EMAIL  a sender address verified in Brevo
 *   BREVO_SENDER_NAME   optional, defaults to "Stashr"
 */
const mailConfigured = () => Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);

async function sendMail({ to, subject, html, text }) {
  if (!mailConfigured()) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: { email: process.env.BREVO_SENDER_EMAIL, name: process.env.BREVO_SENDER_NAME || "Stashr" }, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
      signal: AbortSignal.timeout(15000)
    });
    return res.ok ? { ok: true } : { ok: false, error: "provider_" + res.status };
  } catch { return { ok: false, error: "provider_unavailable" }; }
}

module.exports = { sendMail, mailConfigured };
