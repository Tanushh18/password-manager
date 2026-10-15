/** The most useful plain-language reason for a failed request: the server's own message, else what the status means. */
export const errorMessage = (err, fallback = "Something went wrong. Please try again.") =>
{
    const said = err?.response?.data?.error;
    if (typeof said === "string" && said.trim()) return said;
    if (!err?.response)
    {
        const timedOut = err?.code === "ECONNABORTED" || /timeout/i.test(String(err?.message || ""));
        return timedOut
            ? "The server took too long to answer. The free server may be waking up (it can take up to a minute) — try again."
            : "We can't reach the server. Check your internet connection; if it is fine, the server may be waking up, restarting or offline — try again in a moment.";
    }
    const status = err.response.status;
    if (status === 429) return "Too many attempts. Please wait a few minutes before trying again.";
    if (status === 404) return "The server could not find what was asked for (HTTP 404). The server address may be out of date.";
    if (status >= 500) return "The server ran into a problem (HTTP " + status + "). It may be waking up or restarting — try again in a minute.";
    return fallback;
};
