const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

module.exports = (async () => {
  const defaultConfig = await getDefaultConfig(projectRoot);

  return mergeConfig(defaultConfig, {
    watchFolders: [workspaceRoot],

    resolver: {
      nodeModulesPaths: [
        path.resolve(projectRoot, 'node_modules'),
        path.resolve(workspaceRoot, 'node_modules'),
      ],
      extraNodeModules: {
        react: path.resolve(workspaceRoot, 'node_modules/react'),
        'react-native': path.resolve(workspaceRoot, 'node_modules/react-native'),
        'react/jsx-runtime': path.resolve(workspaceRoot, 'node_modules/react/jsx-runtime'),
        'react/jsx-dev-runtime': path.resolve(workspaceRoot, 'node_modules/react/jsx-dev-runtime'),
        '@babel/runtime': path.resolve(workspaceRoot, 'node_modules/@babel/runtime'),
        invariant: path.resolve(workspaceRoot, 'node_modules/invariant'),
      },
    },
  });
})();
