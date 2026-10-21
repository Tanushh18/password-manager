const mongoose = require("mongoose");
const User = require("../models/schema");

/* Shared helpers for the Photo Cloud routes. Records are sealed with the user's data key. */
const clean = (value, max = 200) => String(value || "").trim().slice(0, max);

// Stable ids: a record keeps the id it was created with; `_eid` is the database entry id used to update it in place.
const decode = (entries, key) => (entries || []).map((entry) => {
    try { const fields = User.publicEntry(entry, key); return { ...fields, id: fields.id || String(entry._id), _eid: String(entry._id) }; }
    catch { return null; }
}).filter(Boolean);
const strip = ({ _eid, ...rest }) => rest;
const encoded = (key, value) => ({ _id: new mongoose.Types.ObjectId(), enc: "udk", data: User.sealEntry(key, strip(value)), createdAt: new Date(), updatedAt: new Date() });
const publicConnection = (connection) => { const { accessToken, refreshToken, tokenType, expiresAt, _eid, folderId, ...safe } = connection; return safe; };

/** Replace one sealed record in place (keeps its entry id, so concurrent records are not rewritten). */
const updateEntry = (user, field, record, key) => User.updateOne(
    { _id: user._id, [field + "._id"]: record._eid },
    { $set: { [field + ".$.data"]: User.sealEntry(key, strip(record)), [field + ".$.updatedAt"]: new Date() } }
);
const pushEntry = (user, field, record, key) => { const entry = encoded(key, record); return User.updateOne({ _id: user._id }, { $push: { [field]: entry } }).then(() => String(entry._id)); };

const refreshGoogleToken = async (connection) => {
    if (!connection.refreshToken || !process.env.GOOGLE_CLIENT_ID) return false;
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: connection.refreshToken, grant_type: "refresh_token" }) });
    const tokens = await response.json().catch(() => ({}));
    if (!response.ok || !tokens.access_token) return false;
    connection.accessToken = tokens.access_token; connection.tokenType = tokens.token_type || "Bearer"; connection.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
    return true;
};

/** Calls Google with the connection's token; refreshes it once on 401 and saves the new token. */
async function driveFetch(user, key, connection, url, options = {}) {
    const send = () => fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${connection.accessToken}` } });
    let response = await send();
    if (response.status === 401 && await refreshGoogleToken(connection)) {
        if (connection._eid) await updateEntry(user, "photoConnections", connection, key);
        response = await send();
    }
    return response;
}

module.exports = { clean, decode, encoded, strip, publicConnection, updateEntry, pushEntry, refreshGoogleToken, driveFetch };
