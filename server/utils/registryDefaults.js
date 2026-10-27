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
const APP_LABELS = { stashr: "Stashr", dealradar: "Deal Radar", wethree: "We Three" };

module.exports = { ADMINS, DEFAULTS, APP_LABELS };
