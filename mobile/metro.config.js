const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// The on-device face model ships as a bundled asset.
config.resolver.assetExts.push("tflite");

module.exports = config;
