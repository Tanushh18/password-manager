// Shared by the registry router and the Render sync, so both agree on the apps, defaults and admins.
const ADMINS = (process.env.REGISTRY_ADMINS || "tanushchawla16@gmail.com")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

// Used until an admin saves something. Mirrors what each app ships with.
const DEFAULTS = {
    stashr: [
        "https://password-manager-server-xxdr.onrender.com"
    ],
    dealradar: ["https://dealradar.ggnhome.com"],
    wethree: ["https://we-three-api-r310.onrender.com/api"]
};
// Built-in apps that may be switched off completely (empty list) to test that the app stops using its server.
// The others always keep a server.
const OFFABLE = new Set(["wethree", "dealradar"]);
const APP_LABELS = { stashr: "Stashr", dealradar: "Deal Radar", wethree: "We Three" };

const isAdminEmail = (email) => Boolean(email && ADMINS.includes(String(email).toLowerCase()));
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** The URLs an app uses: its saved list, an empty list when it was switched off, otherwise the built-in default. */
const urlsFor = (doc, app) =>
{
    if (doc && doc.urls && doc.urls.length) return doc.urls;
    if (doc && doc.off && OFFABLE.has(app)) return [];
    return DEFAULTS[app];
};

module.exports = { ADMINS, DEFAULTS, OFFABLE, APP_LABELS, isAdminEmail, SLUG, urlsFor };
