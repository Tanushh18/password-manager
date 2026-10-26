const jwt = require('jsonwebtoken');
const User = require("../models/schema");

/**
 * Reads the session token from either
 *   - the httpOnly `jwtoken` cookie (web client), or
 *   - an `Authorization: Bearer <token>` header (Android / iOS app).
 */
const readToken = (req) =>
{
    const header = req.headers.authorization || "";
    if (header.toLowerCase().startsWith("bearer "))
    {
        const bearer = header.slice(7).trim();
        if (bearer) return bearer;
    }
    return (req.cookies && req.cookies.jwtoken) || null;
};

/**
 * Every session token the request carries, best first. A browser can hold two `jwtoken` cookies at once (an older
 * non-partitioned one and the current partitioned one) and cookie-parser only exposes the first, which may be stale.
 */
const readTokens = (req) =>
{
    const list = [];
    const header = req.headers.authorization || "";
    if (header.toLowerCase().startsWith("bearer ")) { const bearer = header.slice(7).trim(); if (bearer) list.push(bearer); }
    const raw = String(req.headers.cookie || "");
    for (const part of raw.split(";"))
    {
        const i = part.indexOf("=");
        if (i > 0 && part.slice(0, i).trim() === "jwtoken")
        {
            let value = part.slice(i + 1).trim();
            try { value = decodeURIComponent(value); } catch (e) { /* keep as is */ }
            if (value) list.push(value);
        }
    }
    const parsed = req.cookies && req.cookies.jwtoken;
    if (parsed) list.push(parsed);
    return [...new Set(list)];
};

/*
 * The account document carries large monitoring histories. Loading them on every request (the Render page polls
 * several times a minute) is what made sign-in and every page slow, so a request only loads the histories its route
 * reads. A route not listed here under /render or /telegram loads everything (the safe default).
 */
const HISTORY = User.HISTORY_FIELDS;
const NEEDS = [
    [/^\/render\/accounts(\/|$)/, null, []],
    [/^\/render\/ops\/(status|pings|config)$/, "GET", []],
    [/^\/render\/ops\/history$/, "GET", ["renderMetricHistory"]],
    [/^\/render\/ops\/incidents$/, "GET", ["renderIncidents"]],
    [/^\/render\/audit$/, "GET", ["renderAudit"]],
    [/^\/render\/usage-settings$/, null, []],
    [/^\/render\/usage-needs$/, "GET", []],
    [/^\/render\/live-dashboard$/, "GET", ["usageHistory"]],
    [/^\/render\/registry-sync(\/|$)/, null, []],
    [/^\/render\/projects\/status$/, "GET", ["renderIncidents"]]
];
const PATH = (req) => String(req.originalUrl || req.url || "").split("?")[0].replace(/\/+$/, "") || "/";
const historyFieldsFor = (req) =>
{
    const path = PATH(req);
    if (/^\/(render|telegram)(\/|$)/.test(path))
    {
        for (const [pattern, method, fields] of NEEDS) if (pattern.test(path) && (!method || method === req.method)) return fields;
        return HISTORY;
    }
    return [];
};
// Fields a route never reads are not loaded at all (hydrating the document is the main cost on a small server).
// The vault (`passwords`) is only read by sign-in/vault/extension/telegram routes.
const excludedFieldsFor = (req) =>
{
    const needed = historyFieldsFor(req);
    const excluded = HISTORY.filter((field) => !needed.includes(field));
    if (/^\/(render|github|projects)(\/|$)/.test(PATH(req))) excluded.push("passwords");
    // The photo library is by far the largest part of the account and only the photo routes read it. Loading it for
    // every other request (Render pages poll several routes at once) is what made each call take 15-25 seconds.
    if (!/^\/(photo-cloud|photo-import|worker|public)(\/|$)/.test(PATH(req))) excluded.push(...User.PHOTO_FIELDS);
    // The profile load right after sign-in only returns the vault and projects, not the photo library or connections.
    if (req.method === "GET" && PATH(req) === "/authenticate") excluded.push(...User.BULK_FIELDS.filter((f) => !excluded.includes(f)));
    return excluded;
};
const leanProjection = (excluded) => Object.fromEntries(excluded.map((field) => [field, 0]));

const authenticate = async (req, res, next) =>
{
    try
    {
        const tokens = readTokens(req);
        if (!tokens.length)
        {
            console.warn(`[auth] 401 ${req.method} ${req.path}: no token (cookie=${Boolean(req.cookies && req.cookies.jwtoken)}, bearer=${/^bearer /i.test(req.headers.authorization || "")}, origin=${req.headers.origin || "-"})`);
            return res.status(401).json({ error: "Access denied. No token provided." });
        }

        const projection = leanProjection(excludedFieldsFor(req));
        let badTokenError = null, staleUser = null;
        for (const token of tokens)
        {
            let verify;
            try { verify = jwt.verify(token, process.env.SECRET_KEY); }
            catch (error) { badTokenError = badTokenError || error; continue; }

            const rootUser = await User.findOne({ _id: verify._id, "tokens.token": token }, Object.keys(projection).length ? projection : undefined);
            if (!rootUser) { staleUser = verify._id; continue; }

            req.token = token;
            req.rootUser = rootUser;
            req.userId = rootUser._id;
            return next();
        }

        if (staleUser)
        {
            console.warn(`[auth] 401 ${req.method} ${req.path}: token is valid but not in this account's sessions (user=${staleUser}, tokens=${tokens.length}, origin=${req.headers.origin || "-"})`);
            return res.status(401).json({ error: "Unauthorised user." });
        }
        throw badTokenError;
    }
    catch (error)
    {
        // Only a token that is missing, malformed, expired or revoked means "not signed in". A database or network
        // hiccup must not look like a sign-out (the client drops the session on a 401), so it is a retryable 503.
        // Never log the token or the signing secret.
        const badToken = error && (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError" || error.name === "NotBeforeError");
        console.warn(`[auth] ${badToken ? "401" : "503"} ${req.method} ${req.path}: ${error && error.name}: ${error && error.message}`);
        if (badToken) return res.status(401).json({ error: "Unauthorised user." });
        res.set("Retry-After", "5");
        return res.status(503).json({ error: "The server had a temporary problem. Your session is fine; try again in a moment." });
    }
};

authenticate.readToken = readToken;
authenticate.readTokens = readTokens;
authenticate.historyFieldsFor = historyFieldsFor;
authenticate.excludedFieldsFor = excludedFieldsFor;

module.exports = authenticate;
