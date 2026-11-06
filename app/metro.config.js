const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Platform-specific components live in src/components/ios/<name>.ios.tsx and
// src/components/android/<name>.android.tsx; `@/components/<name>` picks the one
// for the platform being bundled. Shared components stay in src/components/.
const components = path.join(__dirname, 'src/components');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = moduleName.match(/^@\/components\/([\w-]+)$/)?.[1];
  if (name && (platform === 'ios' || platform === 'android')) {
    for (const ext of ['.tsx', '.ts']) {
      const file = path.join(components, platform, `${name}.${platform}${ext}`);
      if (fs.existsSync(file)) return { type: 'sourceFile', filePath: file };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
