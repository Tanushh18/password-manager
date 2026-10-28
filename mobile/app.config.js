// EAS Update configuration for Stashr.
// EAS init adds extra.eas.projectId to app.json in the release workflow. EAS_PROJECT_ID
// is also accepted for controlled CI environments. Without an ID we explicitly disable OTA.
module.exports = ({ config }) => {
  const extra = config.extra || {};
  const projectId = String(process.env.EAS_PROJECT_ID || extra.eas?.projectId || "").trim();
  const buildProfile = process.env.EAS_BUILD_PROFILE || "";
  const channel = String(
    process.env.STASHR_UPDATE_CHANNEL ||
    (["development", "preview", "production"].includes(buildProfile) ? buildProfile : "")
  ).trim();

  const updates = projectId
    ? {
        enabled: true,
        url: `https://u.expo.dev/${projectId}`,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
        ...(channel ? { requestHeaders: { "expo-channel-name": channel } } : {}),
      }
    : { enabled: false };

  return {
    ...config,
    extra: projectId
      ? { ...extra, eas: { ...(extra.eas || {}), projectId } }
      : extra,
    updates,
  };
};
