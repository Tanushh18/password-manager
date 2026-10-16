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
    [/^\/render\/live-dashboard$/, "GET", ["usageHistory"]]
];
const historyFieldsFor = (req) =>
{
    const path = String(req.originalUrl || req.url || "").split("?")[0].replace(/\/+$/, "") || "/";
    if (/^\/(render|telegram)(\/|$)/.test(path))
    {
        for (const [pattern, method, fields] of NEEDS) if (pattern.test(path) && (!method || method === req.method)) return fields;
        return HISTORY;
    }
    return [];
};
const leanProjection = (needed) => Object.fromEntries(HISTORY.filter((field) => !needed.includes(field)).map((field) => [field, 0]));

const authenticate = async (req, res, next) =>
{
    try
    {
        const token = readToken(req);
        if (!token)
        {
            console.warn(`[auth] 401 ${req.method} ${req.path}: no token (cookie=${Boolean(req.cookies && req.cookies.jwtoken)}, bearer=${/^bearer /i.test(req.headers.authorization || "")}, origin=${req.headers.origin || "-"})`);
            return res.status(401).json({ error: "Access denied. No token provided." });
        }

        const verify = jwt.verify(token, process.env.SECRET_KEY);
        const projection = leanProjection(historyFieldsFor(req));
        const rootUser = await User.findOne({ _id: verify._id, "tokens.token": token }, Object.keys(projection).length ? projection : undefined);

        if (!rootUser)
        {
            console.warn(`[auth] 401 ${req.method} ${req.path}: token is valid but not in this account's sessions (user=${verify._id}, origin=${req.headers.origin || "-"})`);
            return res.status(401).json({ error: "Unauthorised user." });
        }

        req.token = token;
        req.rootUser = rootUser;
        req.userId = rootUser._id;

        next();
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
authenticate.historyFieldsFor = historyFieldsFor;

module.exports = authenticate;
