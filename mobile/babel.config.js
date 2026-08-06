const fs = require('fs');
const path = require('path');

/**
 * react-native-dotenv inlines env values at build time, so the file chosen here
 * is baked into the bundle. This used to be hardcoded to '.env', which meant
 * `.env.production` was never read by any build — production only worked as
 * long as somebody remembered to copy it over `.env` by hand, and a leftover
 * development `.env` shipped a release APK pointing at localhost.
 *
 *   ENVFILE=.env.office npm run android   → explicit override, wins over all
 *   release / production bundle           → .env.production when it exists
 *   anything else (Metro dev server)      → .env
 */
function resolveEnvFile() {
  const explicit = process.env.ENVFILE;
  if (explicit) {
    return explicit;
  }

  const isProduction = (process.env.BABEL_ENV || process.env.NODE_ENV) === 'production';
  if (isProduction && fs.existsSync(path.resolve(__dirname, '.env.production'))) {
    return '.env.production';
  }

  return '.env';
}

module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: resolveEnvFile(),
        blacklist: null,
        whitelist: null,
        safe: false,
        allowUndefined: true,
      },
    ],
    // 'react-native-reanimated/plugin',
  ],
};
