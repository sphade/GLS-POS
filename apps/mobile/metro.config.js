const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// better-auth exposes its subpaths (e.g. "better-auth/react" -> dist/client/react
// /index.mjs) ONLY through the package.json "exports" map. Metro on SDK 52
// ignores that map unless this flag is on, which makes those imports fail to
// resolve. Required for lib/auth-client.ts.
config.resolver.unstable_enablePackageExports = true;

// Prefer the standard conditions; "require" first keeps CJS-only deps working.
config.resolver.unstable_conditionNames = ["react-native", "browser", "require", "import"];

// Metro's default assetExts covers mp3/wav but not ogg — register the extra
// audio formats we bundle.
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, "ogg", "m4a", "aac"])];

// better-auth ships .mjs entry points.
config.resolver.sourceExts = [...new Set([...config.resolver.sourceExts, "mjs"])];

module.exports = config;
