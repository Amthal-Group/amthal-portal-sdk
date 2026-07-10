const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * The wrapper and the bridge are linked with `file:` (symlinks), so Metro
 * must watch their real locations and resolve their deps from this app's
 * node_modules.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    path.resolve(__dirname, '../../wrappers/react-native'),
    path.resolve(__dirname, '../../bridge'),
  ],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
