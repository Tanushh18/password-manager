// EAS Update configuration for Stashr.
// The release workflows link this app to EAS before generating or publishing bundles.
module.exports = ({ config }) => {
  const extra = config.extra || {};
  const projectId = String(process.env.EAS_PROJECT_ID || extra.eas?.projectId || "").trim();
  const buildProfile = process.env.EAS_BUILD_PROFILE || "";
  const channel = String(
    process.env.STASHR_UPDATE_CHANNEL ||
    (["development", "preview", "production"].includes(buildProfile) ? buildProfile : "")
  ).trim();
  const otaVersion = String(
    process.env.STASHR_OTA_VERSION ||
    process.env.EXPO_PUBLIC_OTA_VERSION ||
    extra.stashrRelease?.otaVersion ||
    "native"
  ).trim();

  const updates = projectId
    ? {
        enabled: true,
        url: "https://u.expo.dev/" + projectId,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
        ...(channel ? { requestHeaders: { "expo-channel-name": channel } } : {}),
      }
    : { enabled: false };

  const stashrRelease = {
    ...(extra.stashrRelease || {}),
    appVersion: config.version || "unknown",
    otaVersion,
    channel: channel || "unassigned",
  };

  return {
    ...config,
    extra: projectId
      ? { ...extra, eas: { ...(extra.eas || {}), projectId }, stashrRelease }
      : { ...extra, stashrRelease },
    updates,
  };
};
