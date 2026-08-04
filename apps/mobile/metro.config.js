const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Metro's default assetExts covers mp3/wav but not ogg — register the extra
// audio formats we bundle. Do NOT disable unstable_enablePackageExports:
// better-auth relies on package exports to resolve its modules.
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, "ogg", "m4a", "aac"])];

module.exports = config;
