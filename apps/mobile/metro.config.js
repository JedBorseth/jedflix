const { getDefaultConfig } = require("expo/metro-config");
const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force Metro to use the mobile app's core packages (avoids stale RN 0.86 in .bun cache).
const singletons = [
  "react",
  "react-dom",
  "react-native",
  "expo",
  "expo-router",
  "expo-modules-core",
  "expo-constants",
  "@expo/metro-runtime",
];

config.resolver.extraNodeModules = singletons.reduce((acc, name) => {
  const localPath = path.resolve(projectRoot, "node_modules", name);
  if (fs.existsSync(localPath)) {
    acc[name] = localPath;
  }
  return acc;
}, {});

module.exports = config;
