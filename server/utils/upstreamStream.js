const { Readable } = require("node:stream");

/**
 * Helpers for sending a big file from another server (an APK or an OTA asset from GitHub) on to the client.
 *
 * Why this exists: `fetch(url, { signal: AbortSignal.timeout(30000) })` ends the WHOLE download after 30 seconds, not just the wait for
 * the first answer. An 83 MB APK on a slow phone takes longer, the timer fires in the middle of the body, the body stream emits an
 * error, and with nobody listening Node throws an uncaught exception, which makes the server exit and restart (everyone then sees
 * "server waking up"). So: the timeout covers only the wait for the response headers, and the body stream always has an error handler.
 */

/** fetch() whose timeout covers only the wait for the response headers. */
async function fetchWithHeaderTimeout(url, options = {}, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Streams a fetch() response to the client. A broken or slow download only closes this one response; it never throws. */
function pipeUpstream(response, res) {
  const body = Readable.fromWeb(response.body);
  body.on("error", () => res.destroy());
  res.on("close", () => body.destroy());
  return body.pipe(res);
}

module.exports = { fetchWithHeaderTimeout, pipeUpstream };
