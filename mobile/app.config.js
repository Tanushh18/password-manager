// Stashr updates are delivered as signed, complete APKs from the Stashr API server.
// Expo/EAS OTA is deliberately disabled: native modules and permission changes must ship
// inside a freshly built APK and be installed by Android's package installer.
module.exports = ({ config }) => {
  const extra = config.extra || {};
  return {
    ...config,
    extra: {
      ...extra,
      stashrRelease: {
        ...(extra.stashrRelease || {}),
        appVersion: config.version || "unknown",
        channel: "server-managed",
        delivery: "server-managed-apk",
      },
    },
    updates: {
      ...(config.updates || {}),
      enabled: false,
      checkAutomatically: "NEVER",
    },
  };
};
