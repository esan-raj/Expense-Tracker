const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// RxDB 17 publishes plugin sources as TypeScript shims under
// plugins/<name>/index.ts that re-export ../../dist/types/... (declaration
// files only). Metro resolves those shims instead of package.json "exports",
// so we map official `rxdb/plugins/<name>` specifiers to the compiled ESM
// files that RxDB already ships (the same targets as exports.import).
config.resolver.unstable_enablePackageExports = true;

const defaultResolveRequest = config.resolver.resolveRequest;

function resolveRxdbPlugin(moduleName) {
  if (!moduleName.startsWith('rxdb/plugins/')) {
    return null;
  }
  const pluginName = moduleName.slice('rxdb/plugins/'.length);
  if (!pluginName || pluginName.includes('..') || path.isAbsolute(pluginName)) {
    return null;
  }
  const filePath = path.resolve(
    __dirname,
    'node_modules',
    'rxdb',
    'dist',
    'esm',
    'plugins',
    pluginName,
    'index.js'
  );
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return { type: 'sourceFile', filePath };
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const rxdbResolved = resolveRxdbPlugin(moduleName);
  if (rxdbResolved) {
    return rxdbResolved;
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
