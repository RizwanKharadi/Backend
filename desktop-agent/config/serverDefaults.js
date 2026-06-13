const PRODUCTION_SERVER = {
  url: 'wss://web-production-577680.up.railway.app/tally-agent',
  apiUrl: 'https://web-production-577680.up.railway.app/api',
};

const DEVELOPMENT_SERVER = {
  url: 'ws://127.0.0.1:5000/tally-agent',
  apiUrl: 'http://127.0.0.1:5000/api',
};

function isPackagedApp() {
  try {
    const { app } = require('electron');
    return Boolean(app?.isPackaged);
  } catch {
    return process.env.NODE_ENV === 'production';
  }
}

function isLocalServerUrl(value) {
  if (!value || typeof value !== 'string') {
    return true;
  }
  return /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(value.trim());
}

function getServerDefaults(forPackaged = isPackagedApp()) {
  return forPackaged ? { ...PRODUCTION_SERVER } : { ...DEVELOPMENT_SERVER };
}

module.exports = {
  PRODUCTION_SERVER,
  DEVELOPMENT_SERVER,
  isPackagedApp,
  isLocalServerUrl,
  getServerDefaults,
};
