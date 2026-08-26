const {
  withDangerousMod,
  withProjectBuildGradle,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

function findModule(appRoot) {
  const candidates = [
    path.join(appRoot, "node_modules", "react-native-bluetooth-classic"),
    path.join(appRoot, "..", "node_modules", "react-native-bluetooth-classic"),
    path.join(appRoot, "..", "..", "node_modules", "react-native-bluetooth-classic"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "android"))) return p;
  }
  return null;
}

module.exports = function withBluetoothClassic(config) {
  config = withDangerousMod(config, [
    "android",
    (cfg) => {
      const moduleDir = findModule(cfg.modRequest.projectRoot);
      if (!moduleDir) {
        console.warn("[withBluetoothClassic] react-native-bluetooth-classic not found — skipping");
        return cfg;
      }

      // --- settings.gradle: register the native project ---
      const settingsPath = path.join(cfg.modRequest.platformProjectRoot, "settings.gradle");
      let settings = fs.readFileSync(settingsPath, "utf-8");
      const includeLine = `include ':react-native-bluetooth-classic'`;
      if (!settings.includes("react-native-bluetooth-classic")) {
        const projectDir = moduleDir.replace(/\\/g, "\\\\");
        settings = `include ':react-native-bluetooth-classic'\nproject(':react-native-bluetooth-classic').projectDir = new File('${projectDir}')\n` + settings;
        fs.writeFileSync(settingsPath, settings, "utf-8");
      }

      // --- app/build.gradle: add dependency ---
      const appBuildPath = path.join(cfg.modRequest.platformProjectRoot, "app", "build.gradle");
      if (fs.existsSync(appBuildPath)) {
        let build = fs.readFileSync(appBuildPath, "utf-8");
        if (!build.includes("react-native-bluetooth-classic")) {
          build = build.replace(
            /dependencies\s*\{/,
            "dependencies {\n    implementation project(':react-native-bluetooth-classic')",
          );
          fs.writeFileSync(appBuildPath, build, "utf-8");
        }
      }

      return cfg;
    },
  ]);

  return config;
};
