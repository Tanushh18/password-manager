// Extends app.json. Once `eas init` has linked an EAS project, enable
// over-the-air updates from that project automatically.
module.exports = ({ config }) => {
  const projectId = config.extra?.eas?.projectId;
  return {
    ...config,
    updates: projectId
      ? { url: `https://u.expo.dev/${projectId}`, checkAutomatically: "ON_LOAD", fallbackToCacheTimeout: 0 }
      : { enabled: false },
  };
};
