/**
 * Self ping helper.
 *
 * Free hosting tiers (Render, Cyclic, Fly ...) put an instance to sleep after a
 * few minutes without traffic, which is why the first login of the day is slow.
 * This pings our own /health endpoint on an interval so the instance stays warm.
 *
 * It only runs when a public URL is known, so local development is untouched.
 *
 *   SELF_URL             - public url of this server (https://your-api.onrender.com)
 *   RENDER_EXTERNAL_URL  - injected automatically by Render
 *   KEEP_ALIVE           - "false" disables it, "true" forces it on
 *   KEEP_ALIVE_MINUTES   - interval, defaults to 14 minutes
 */

const http = require("http");
const https = require("https");

const DEFAULT_INTERVAL_MINUTES = 14;

const getSelfUrl = () =>
{
    const raw = process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL;
    if (!raw) return null;

    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!trimmed) return null;

    return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const pingOnce = (url) => new Promise((resolve) =>
{
    const client = url.startsWith("https") ? https : http;

    const request = client.get(url, { timeout: 15000 }, (res) =>
    {
        res.resume(); // drain so the socket can be reused
        resolve(res.statusCode);
    });

    request.on("timeout", () =>
    {
        request.destroy();
        resolve(null);
    });

    request.on("error", () => resolve(null));
});

const startKeepAlive = () =>
{
    if (String(process.env.KEEP_ALIVE).toLowerCase() === "false")
    {
        console.log("keep-alive       : disabled via KEEP_ALIVE=false");
        return null;
    }

    const selfUrl = getSelfUrl();

    if (!selfUrl)
    {
        console.log("keep-alive       : idle (set SELF_URL to enable self ping)");
        return null;
    }

    const minutes = Number(process.env.KEEP_ALIVE_MINUTES) || DEFAULT_INTERVAL_MINUTES;
    const intervalMs = Math.max(1, minutes) * 60 * 1000;
    const healthUrl = `${selfUrl}/health`;

    console.log(`keep-alive       : pinging ${healthUrl} every ${minutes} min`);

    const timer = setInterval(async () =>
    {
        const status = await pingOnce(healthUrl);
        const stamp = new Date().toISOString();

        if (status === 200)
        {
            console.log(`[keep-alive] ${stamp} - server awake (200)`);
        }
        else
        {
            console.warn(`[keep-alive] ${stamp} - ping failed (${status || "no response"})`);
        }
    }, intervalMs);

    // Never hold the event loop open just for the ping timer
    if (typeof timer.unref === "function") timer.unref();

    return timer;
};

module.exports = { startKeepAlive, pingOnce, getSelfUrl };
